FROM node:24-alpine
WORKDIR /app
COPY server.js /app/server.js
COPY proxy.js /app/proxy.js
USER node
EXPOSE 8080
CMD ["node", "/app/server.js"]
