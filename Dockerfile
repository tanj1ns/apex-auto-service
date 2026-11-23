FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY server ./server
COPY css ./css
COPY js ./js
COPY images ./images
COPY *.html ./

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 3000
CMD ["node", "server.js"]
