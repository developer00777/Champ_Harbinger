"""
Trafilatura content-extraction microservice.

ChampHarbinger calls this HTTP service from the Next.js app when it needs a
clean text/markdown/JSON representation of a web article (news, blog post,
docs page, etc.) — Trafilatura is significantly more accurate than the
regex/cheerio pipelines we used to ship with.

Endpoints
---------
GET  /health           -> {ok: bool, service: "trafilatura"}
POST /extract          -> {url? | html?, options?} -> ExtractedContent
POST /extract-batch    -> {urls, max_concurrent?}  -> ExtractedContent[]

The service NEVER raises on a single failed extraction — it returns
`{success: false, error: "..."}` so the calling code can keep going.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Literal, Optional

import httpx
import trafilatura
from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger("trafilatura-service")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="ChampHarbinger Trafilatura", version="1.0.0")

USER_AGENT = "ChampHarbinger/1.0 (+https://champions.group)"
FETCH_TIMEOUT_S = 15.0
PER_URL_TIMEOUT_S = 30.0


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ExtractOptions(BaseModel):
    include_links: bool = False
    include_images: bool = False
    output_format: Literal["text", "markdown", "json"] = "text"


class ExtractRequest(BaseModel):
    url: Optional[str] = None
    html: Optional[str] = None
    options: Optional[ExtractOptions] = None


class ExtractBatchRequest(BaseModel):
    urls: List[str] = Field(default_factory=list)
    max_concurrent: int = 5
    options: Optional[ExtractOptions] = None


class ExtractedContent(BaseModel):
    url: str
    success: bool
    title: Optional[str] = None
    author: Optional[str] = None
    date: Optional[str] = None
    language: Optional[str] = None
    text: Optional[str] = None
    markdown: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Core extraction logic
# ---------------------------------------------------------------------------


def _tfa_format(out: Literal["text", "markdown", "json"]) -> str:
    """Map our public-API names to Trafilatura's internal names."""
    if out == "markdown":
        return "markdown"
    if out == "json":
        return "json"
    return "txt"


def _extract_sync(
    html: str,
    url: Optional[str],
    options: ExtractOptions,
) -> ExtractedContent:
    """Run Trafilatura against a raw HTML string. Pure / synchronous."""
    fmt = _tfa_format(options.output_format)

    try:
        raw = trafilatura.extract(
            html,
            url=url,
            output_format=fmt,
            with_metadata=True,
            include_links=options.include_links,
            include_images=options.include_images,
            favor_recall=True,
        )
    except Exception as exc:  # noqa: BLE001 — trafilatura wraps a lot
        logger.warning("trafilatura.extract crashed for %s: %s", url, exc)
        return ExtractedContent(
            url=url or "",
            success=False,
            error=f"extraction_crashed: {exc}",
        )

    if not raw:
        return ExtractedContent(
            url=url or "",
            success=False,
            error="extraction_returned_empty",
        )

    # Trafilatura returns metadata + body together when output_format='json'.
    # For text/markdown, we re-derive metadata separately so the caller always
    # gets the structured fields.
    meta = trafilatura.extract_metadata(html, default_url=url)
    meta_dict: Dict[str, Any] = {}
    title = author = date = language = None
    if meta is not None:
        try:
            meta_dict = meta.as_dict()
        except Exception:  # noqa: BLE001
            meta_dict = {}
        title = meta_dict.get("title")
        author = meta_dict.get("author")
        date = meta_dict.get("date")
        language = meta_dict.get("language")

    result = ExtractedContent(
        url=url or "",
        success=True,
        title=title,
        author=author,
        date=date,
        language=language,
        metadata=meta_dict or None,
    )

    if fmt == "markdown":
        result.markdown = raw
        # Also expose a plain-text fallback so callers always have `.text`.
        try:
            txt = trafilatura.extract(
                html,
                url=url,
                output_format="txt",
                with_metadata=False,
                favor_recall=True,
            )
            if txt:
                result.text = txt
        except Exception:  # noqa: BLE001
            pass
    elif fmt == "json":
        # Stuff the parsed JSON object onto metadata so the wire shape stays
        # `{text, markdown?, metadata}` regardless of output_format.
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                merged = {**(meta_dict or {}), **parsed}
                result.metadata = merged
                if isinstance(parsed.get("text"), str):
                    result.text = parsed["text"]
        except json.JSONDecodeError:
            result.text = raw
    else:  # text
        result.text = raw

    return result


async def _fetch_html(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(
        url,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.text


async def _extract_one(
    client: httpx.AsyncClient,
    url: str,
    options: ExtractOptions,
    sem: Optional[asyncio.Semaphore] = None,
) -> ExtractedContent:
    """Fetch + extract a single URL with timeouts and graceful failure."""

    async def _go() -> ExtractedContent:
        try:
            html = await asyncio.wait_for(
                _fetch_html(client, url), timeout=PER_URL_TIMEOUT_S
            )
        except asyncio.TimeoutError:
            return ExtractedContent(url=url, success=False, error="fetch_timeout")
        except httpx.HTTPStatusError as exc:
            return ExtractedContent(
                url=url,
                success=False,
                error=f"http_{exc.response.status_code}",
            )
        except Exception as exc:  # noqa: BLE001
            return ExtractedContent(
                url=url, success=False, error=f"fetch_failed: {exc}"
            )

        # Trafilatura is CPU-bound — offload so we don't block the loop.
        return await asyncio.to_thread(_extract_sync, html, url, options)

    if sem is None:
        return await _go()
    async with sem:
        return await _go()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "service": "trafilatura"}


@app.post("/extract", response_model=ExtractedContent)
async def extract(req: ExtractRequest) -> ExtractedContent:
    options = req.options or ExtractOptions()

    if not req.url and not req.html:
        return ExtractedContent(
            url="", success=False, error="missing_url_or_html"
        )

    if req.html:
        return await asyncio.to_thread(
            _extract_sync, req.html, req.url, options
        )

    # URL-only path: fetch then extract.
    async with httpx.AsyncClient() as client:
        return await _extract_one(client, req.url or "", options)


@app.post("/extract-batch", response_model=List[ExtractedContent])
async def extract_batch(req: ExtractBatchRequest) -> List[ExtractedContent]:
    options = req.options or ExtractOptions()
    max_concurrent = max(1, min(20, req.max_concurrent or 5))
    sem = asyncio.Semaphore(max_concurrent)

    async with httpx.AsyncClient() as client:
        tasks = [_extract_one(client, url, options, sem) for url in req.urls]
        return await asyncio.gather(*tasks)
