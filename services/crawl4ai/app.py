"""
Crawl4AI FastAPI microservice.

Wraps crawl4ai's AsyncWebCrawler behind a small HTTP API so the TypeScript
side of ChampHarbinger (Next.js) can drive bulk page extraction without
paying per-session Browserbase fees. Markdown + optional LLM-driven JSON
extraction. Designed for 1M+ company crawls — uses asyncio.gather with a
concurrency cap and a hard per-URL timeout so a stuck page can never wedge
the worker.

Endpoints:
    GET  /health        liveness probe
    POST /crawl         crawl a list of URLs (markdown or LLM-extracted JSON)
    POST /bulk-crawl    crawl up to 100 URLs in parallel batches

Errors are caught and reported per-URL inside the response — the request
itself never raises.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

logger = logging.getLogger("crawl4ai-service")
logging.basicConfig(level=logging.INFO)

PER_URL_TIMEOUT_S = 30.0
MAX_BULK_URLS = 100
DEFAULT_CONCURRENCY = 5

app = FastAPI(title="ChampHarbinger Crawl4AI service")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class CrawlRequest(BaseModel):
    urls: list[str] = Field(..., description="URLs to crawl")
    extract_strategy: Optional[str] = Field(
        default="markdown",
        description="'markdown' (default) or 'json' (LLM-driven extraction)",
    )
    query: Optional[str] = Field(
        default=None,
        description="LLM instruction / schema description when extract_strategy='json'",
    )


class BulkCrawlRequest(BaseModel):
    urls: list[str]
    max_concurrent: int = Field(default=DEFAULT_CONCURRENCY, ge=1, le=20)


class CrawlResult(BaseModel):
    url: str
    success: bool
    markdown: Optional[str] = None
    data: Optional[Any] = None
    status_code: Optional[int] = None
    error: Optional[str] = None


class CrawlResponse(BaseModel):
    results: list[CrawlResult]


# ---------------------------------------------------------------------------
# Crawl helpers
# ---------------------------------------------------------------------------


async def _crawl_one(
    crawler: Any,
    url: str,
    extract_strategy: str,
    query: Optional[str],
) -> CrawlResult:
    """Crawl a single URL with a hard timeout. Never raises."""
    try:
        run_kwargs: dict[str, Any] = {"url": url}

        if extract_strategy == "json" and query:
            # Lazy-import to keep the markdown path lightweight if the LLM
            # strategy module changes between crawl4ai versions.
            try:
                from crawl4ai.extraction_strategy import LLMExtractionStrategy

                # Provider/key come from the environment — leave both unset
                # to fall back to crawl4ai's defaults.
                provider = os.getenv("CRAWL4AI_LLM_PROVIDER", "openai/gpt-4o-mini")
                api_token = os.getenv(
                    "CRAWL4AI_LLM_API_KEY",
                    os.getenv("OPENAI_API_KEY", ""),
                )
                run_kwargs["extraction_strategy"] = LLMExtractionStrategy(
                    provider=provider,
                    api_token=api_token,
                    instruction=query,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "LLM extraction unavailable, falling back to markdown: %s",
                    exc,
                )

        result = await asyncio.wait_for(
            crawler.arun(**run_kwargs),
            timeout=PER_URL_TIMEOUT_S,
        )

        # crawl4ai's result shape has shifted across versions; be defensive.
        success = bool(getattr(result, "success", True))
        markdown = (
            getattr(result, "markdown", None)
            or getattr(result, "markdown_v2", None)
            or getattr(result, "cleaned_html", None)
        )
        if hasattr(markdown, "raw_markdown"):
            markdown = markdown.raw_markdown
        status_code = getattr(result, "status_code", None)
        extracted = getattr(result, "extracted_content", None)
        error = None if success else getattr(result, "error_message", "unknown error")

        return CrawlResult(
            url=url,
            success=success,
            markdown=str(markdown) if markdown is not None else None,
            data=extracted,
            status_code=status_code,
            error=error,
        )
    except asyncio.TimeoutError:
        logger.warning("Crawl timeout for %s after %ss", url, PER_URL_TIMEOUT_S)
        return CrawlResult(
            url=url,
            success=False,
            error=f"timeout after {PER_URL_TIMEOUT_S}s",
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Crawl failed for %s", url)
        return CrawlResult(url=url, success=False, error=str(exc))


async def _crawl_many(
    urls: list[str],
    extract_strategy: str,
    query: Optional[str],
    max_concurrent: int,
) -> list[CrawlResult]:
    """Run _crawl_one for every URL with a semaphore-limited concurrency."""
    if not urls:
        return []

    # Lazy-import so the FastAPI app boots even if crawl4ai's imports change
    # — the failure surfaces in /health and per-URL errors instead.
    from crawl4ai import AsyncWebCrawler

    sem = asyncio.Semaphore(max_concurrent)

    async with AsyncWebCrawler(verbose=False) as crawler:

        async def _guarded(u: str) -> CrawlResult:
            async with sem:
                return await _crawl_one(crawler, u, extract_strategy, query)

        return await asyncio.gather(*(_guarded(u) for u in urls))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "crawl4ai"}


@app.post("/crawl", response_model=CrawlResponse)
async def crawl(req: CrawlRequest) -> CrawlResponse:
    extract_strategy = (req.extract_strategy or "markdown").lower()
    results = await _crawl_many(
        urls=req.urls,
        extract_strategy=extract_strategy,
        query=req.query,
        max_concurrent=DEFAULT_CONCURRENCY,
    )
    return CrawlResponse(results=results)


@app.post("/bulk-crawl", response_model=CrawlResponse)
async def bulk_crawl(req: BulkCrawlRequest) -> CrawlResponse:
    urls = req.urls[:MAX_BULK_URLS]
    results = await _crawl_many(
        urls=urls,
        extract_strategy="markdown",
        query=None,
        max_concurrent=req.max_concurrent,
    )
    return CrawlResponse(results=results)
