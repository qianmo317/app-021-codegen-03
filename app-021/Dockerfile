# 教室座位轮换编排 · 多阶段构建
# 构建：node:20-alpine → 运行：nginx:1.27-alpine（只拷 dist 与 nginx 配置）
# 注意：按需求 .dockerignore 排除了 nginx.conf（不进构建上下文），
#       因此运行时配置用 Dockerfile 内嵌 heredoc 维护，内容与仓库根的 nginx.conf 保持一致。
# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码构建（含 public/samples 示例数据）
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM nginx:1.27-alpine
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen       80;
    server_name  _;
    root         /usr/share/nginx/html;
    index        index.html;

    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # 健康检查端点
    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 'ok\n';
    }

    # 哈希资源：永久缓存
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # SPA 回退：history 路由全部回退到 index.html
    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
EOF
COPY --from=build /app/dist /usr/share/nginx/html

# 健康检查（配合 docker-compose HEALTHCHECK）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

EXPOSE 80
