# functions/orchestrator/Dockerfile

FROM node:20-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

EXPOSE 8080
CMD ["npm", "start"]
