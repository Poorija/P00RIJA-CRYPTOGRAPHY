FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY config/nginx.conf /etc/nginx/conf.d/default.conf
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
