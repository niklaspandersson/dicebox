# DiceBox Deployment Guide

This guide covers deploying DiceBox in production environments.

## Architecture Overview

DiceBox uses a minimal server architecture:
- **Signaling Server**: Node.js WebSocket server for peer discovery and WebRTC signaling
- **State Storage**: In-memory (single instance) or Redis (multi-instance)
- **Static Files**: Served directly by the signaling server

All game state is managed peer-to-peer via WebRTC data channels. The server only facilitates initial connections.

## Environment Variables

See `.env.example` for all available configuration options.

### Recommended for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `TURN_URL` | TURN server URL(s) for NAT traversal | `turn:turn.example.com:3478` |
| `TURN_SECRET` | Shared secret for time-limited credentials | `your-secret-here` |
| `REDIS_HOST` | Redis hostname for multi-instance deployments | `redis.example.com` |
| `LOG_LEVEL` | Logging verbosity | `info` |

## Deployment Options

### Docker (Recommended)

```bash
# Build the image
docker build -t dicebox .

# Run with environment variables
docker run -d \
  --name dicebox \
  -p 3000:3000 \
  -e LOG_LEVEL=info \
  dicebox
```

### Docker Compose

```yaml
version: '3.8'
services:
  dicebox:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - LOG_LEVEL=info
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
```

### Kubernetes

The included GitHub Actions workflow deploys to Kubernetes. Key considerations:

1. **Resource Limits**: Set appropriate CPU/memory limits
2. **Health Checks**: The container includes a health check on `/api/health`
3. **Replicas**: Use Redis for state when running multiple replicas

Example deployment patch:
```yaml
spec:
  template:
    spec:
      containers:
        - name: dicebox
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
```

## TURN Server Setup

WebRTC requires TURN servers for connections through symmetric NATs and firewalls. Without TURN, some users won't be able to connect.

### Using coturn

1. Install coturn:
   ```bash
   apt install coturn
   ```

2. Configure `/etc/turnserver.conf`:
   ```
   listening-port=3478
   tls-listening-port=5349
   realm=your-domain.com
   use-auth-secret
   static-auth-secret=your-shared-secret
   ```

3. Set environment variables:
   ```
   TURN_URL=turn:turn.your-domain.com:3478,turns:turn.your-domain.com:5349
   TURN_SECRET=your-shared-secret
   ```

### Cloud TURN Services

Alternatively, use managed TURN services:
- Twilio Network Traversal Service
- Xirsys
- Metered TURN

## Redis Setup

Redis is required for horizontal scaling (multiple server instances).

### Configuration

```bash
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password  # If authentication is enabled
```

### Redis Security

1. Enable authentication in `redis.conf`:
   ```
   requirepass your-redis-password
   ```

2. Use TLS for connections in production
3. Restrict network access to Redis

## Health Monitoring

### Health Check Endpoint

```
GET /api/health
```

Response:
```json
{
  "status": "ok",
  "rooms": 5,
  "peers": 12,
  "turnConfigured": true
}
```

### Logging

Logs are JSON-formatted for easy parsing:

```json
{"level":30,"time":"2024-01-15T10:30:00.000Z","service":"dicebox","roomId":"⚀⚁⚂⚃","msg":"Room created"}
```

Recommended log aggregation: ELK Stack, Grafana Loki, or CloudWatch Logs.

## Security Checklist

- [ ] Use HTTPS/WSS in production (via reverse proxy)
- [ ] Configure TURN server with authentication
- [ ] Enable Redis authentication if using Redis
- [ ] Run container as non-root (default in provided Dockerfile)
- [ ] Set appropriate resource limits
- [ ] Monitor health endpoint

## Reverse Proxy Setup

### Nginx

```nginx
upstream dicebox {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name dice.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://dicebox;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Troubleshooting

### WebRTC connections failing

1. Check TURN server configuration
2. Verify firewall allows UDP traffic on TURN ports
3. Check browser console for ICE candidate errors

### Redis connection issues

1. Verify `REDIS_HOST` and `REDIS_PORT` are correct
2. Check Redis authentication if enabled
3. Verify network connectivity to Redis

### High memory usage

1. Check for room/session leaks (sessions expire after 5 minutes)
2. Monitor peer count via health endpoint
3. Consider enabling Redis for distributed state
