# syntax=docker/dockerfile:1

FROM python:3.12-slim AS runtime

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Smaller image and faster startup than copying node_modules.
RUN addgroup --system --gid 1001 ventloom \
 && adduser --system --uid 1001 --gid 1001 ventloom

COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes=false -r requirements.txt

COPY app ./app

USER ventloom
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
