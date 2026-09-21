# Production Deployment Guide - SkyKin Automatic Dialer

This guide provides instructions for deploying the **SkyKin Automatic Dialer** on any Linux server (Ubuntu/Debian, VPS, or Cloud instance) using Docker.

---

## 1. Quick Start with Docker (Recommended)

### Prerequisites
- Docker Engine (v20.10+)
- Docker Compose (v2.0+)
- Git

### Deployment Steps:
1. **Clone the Repository on the Server:**
   ```bash
   git clone https://github.com/hawiMekonnen/autodial-.git /opt/autodialer
   cd /opt/autodialer
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```
   *(Optionally edit `.env` to change the host port or ESL settings)*

3. **Build & Start the Container:**
   ```bash
   docker compose up -d --build
   ```

4. **Verify Application Status:**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

5. **Access the Application:**
   Open your browser and navigate to:
   ```
   http://YOUR_SERVER_IP:8080
   ```

---

## 2. Nginx Reverse Proxy with SSL (HTTPS & WSS)

To serve the dialer over a custom domain with SSL (e.g., `https://dialer.yourdomain.com`):

### Nginx Virtual Host Configuration (`/etc/nginx/sites-available/autodialer.conf`):
```nginx
server {
    listen 80;
    server_name dialer.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dialer.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/dialer.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dialer.yourdomain.com/privkey.pem;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support for SIP WebRTC
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Enable Site and Obtain Free SSL Certificate:
```bash
sudo ln -s /etc/nginx/sites-available/autodialer.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d dialer.yourdomain.com
sudo systemctl reload nginx
```

---

## 3. Data Persistence & Backups

- The SQLite database is stored in the Docker volume `dialer_data` (`/var/www/html/data`).
- Uploaded voice IVR recordings are stored in `dialer_audio` (`/var/www/html/assets/audio`).

### Create a Database Backup:
```bash
docker compose exec autodialer cp /var/www/html/data/dialer.db /var/www/html/data/dialer_backup_$(date +%Y%m%d).db
```

---

## 4. Default Login Credentials

- **Username**: `Agent1` (or `Agent2`, `101`, `admin`)
- **Default Password**: `123Newadissagentone`
*(Agents can change their password at any time via the user menu or sidebar "Change Password" option).*
