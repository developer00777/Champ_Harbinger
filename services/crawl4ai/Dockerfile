# Crawl4AI microservice — self-hosted Python crawler that replaces paid
# browser-scraping (Browserbase) for bulk signal extraction at 1M+ company
# scale. Bandwidth-only cost.
#
# Build:  docker compose build crawl4ai
# Run:    docker compose up -d crawl4ai
# Health: curl http://localhost:8000/health
FROM python:3.11-slim

# System deps needed by Playwright/Chromium at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Install the Chromium browser Playwright drives — together with the system
# libraries we already pulled in above this is what `--with-deps` would do.
RUN playwright install chromium

COPY app.py ./

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
