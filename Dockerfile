FROM node:20-alpine

# Install mint in /app — node_modules stays here, away from the docs root
WORKDIR /app
COPY package.json .
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install \
  && npm install --save-dev mint@4.2.423

# Docs live in /app/docs — mint dev scans only this subdirectory
COPY . /app/docs
WORKDIR /app/docs
EXPOSE 3000
CMD ["sh", "-c", "node apply-brand.js && npx mint dev --host 0.0.0.0 --port 3000"]
