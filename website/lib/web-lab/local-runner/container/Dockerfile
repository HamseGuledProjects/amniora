FROM node:24-alpine
WORKDIR /app
COPY challenge-server.cjs /app/challenge-server.cjs
COPY ingress-proxy.cjs /app/ingress-proxy.cjs
RUN chmod 0444 /app/challenge-server.cjs /app/ingress-proxy.cjs
USER node
EXPOSE 8080
CMD ["node", "/app/challenge-server.cjs"]
