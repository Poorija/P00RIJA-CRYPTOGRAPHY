FROM nginx:alpine
# Room for many proxied sockets: nginx's stock 1024 connections per worker,
# two per WebSocket, was a second ceiling near 500 people per server.
RUN rm /etc/nginx/conf.d/default.conf \
 && sed -i 's/worker_connections[[:space:]]*[0-9]*;/worker_connections 16384;/' /etc/nginx/nginx.conf \
 && sed -i '/^worker_processes/a worker_rlimit_nofile 65536;' /etc/nginx/nginx.conf \
 && grep -q 'worker_connections 16384;' /etc/nginx/nginx.conf \
 && grep -q 'worker_rlimit_nofile 65536;' /etc/nginx/nginx.conf
# A template, not a finished config. The official entrypoint runs envsubst over
# /etc/nginx/templates and writes the result into conf.d before nginx starts,
# so APP_DOMAIN, APP_ORIGIN and APP_ORIGIN_WS come from the environment of THIS
# container -- which is how one image serves two servers under their own names.
# envsubst only replaces names that are actually set in the environment, so
# nginx's own $host, $scheme and $http_upgrade pass through untouched.
COPY config/nginx.conf /etc/nginx/templates/default.conf.template
# The relay's mirror addresses go into the CSP before the template renders.
COPY --chmod=755 config/nginx-mirror-csp.sh /docker-entrypoint.d/15-mirror-csp.sh
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/rendered-templates
COPY index.html /usr/share/nginx/html/
COPY manifest.webmanifest /usr/share/nginx/html/
COPY sw.js /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY vendor /usr/share/nginx/html/vendor
COPY fonts /usr/share/nginx/html/fonts
COPY assets /usr/share/nginx/html/assets
EXPOSE 8585
CMD ["nginx", "-g", "daemon off;"]
