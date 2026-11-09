# 可选：自带 Nginx 的镜像
#   python tools/build_dist.py
#   docker build -f deploy/Dockerfile -t garrison .
#   docker run --rm -p 8080:80 garrison
FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /var/www/garrison/

EXPOSE 80
