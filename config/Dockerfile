FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
# A template, not a finished config. The official entrypoint runs envsubst over
# /etc/nginx/templates and writes the result into conf.d before nginx starts,
# so APP_DOMAIN, APP_ORIGIN and APP_ORIGIN_WS come from the environment of THIS
# container -- which is how one image serves two servers under their own names.
# envsubst only replaces names that are actually set in the environment, so
# nginx's own $host, $scheme and $http_upgrade pass through untouched.
COPY config/nginx.conf /etc/nginx/templates/default.conf.template
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
