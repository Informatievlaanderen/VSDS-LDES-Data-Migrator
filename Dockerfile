# build environment
FROM node:23-bullseye-slim AS builder
# fix vulnerabilities
ARG NPM_TAG=10.9.2
RUN npm install -g npm@${NPM_TAG}
# build it
WORKDIR /build
COPY . .
RUN npm ci
RUN npm run build

# run environment
FROM node:23.3.0-bullseye-slim
# fix vulnerabilities
# note: trivy insists this to be on the same RUN line
RUN apt-get -y update && apt-get -y upgrade
RUN apt-get -y install apt-utils wget
# install signal-handler wrapper
RUN apt-get -y install dumb-init
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# install package manager
RUN npm install -g npm@${NPM_TAG}
# set parameters
ENV SCHEDULE=
ENV MONGODB_URI=
ENV MONGODB_DATABASE=
ENV KAFKA_BROKER=
ENV KAFKA_TOPIC=
ENV CHUNK_SIZE=
ENV SILENT=
EXPOSE 80
# install migrator
ENV NODE_ENV=production
RUN mkdir /home/node/migrator
RUN chown node:node /home/node/migrator
WORKDIR /home/node/migrator
COPY --chown=node:node --from=builder /build/package*.json ./
COPY --chown=node:node --from=builder /build/dist/*.js ./
RUN npm ci --omit=dev
# run as node
USER node
CMD ["sh", "-c", "node ./db-migrate.js --host=0.0.0.0 --port=80 --silent=\"${SILENT}\" --schedule=\"${SCHEDULE}\" --chunk-size=\"${CHUNK_SIZE}\" --mongodb-uri=\"${MONGODB_URI}\" --mongodb-database=\"${MONGODB_DATABASE}\" --kafka-broker=\"${KAFKA_BROKER}\" --kafka-topic=\"${KAFKA_TOPIC}\""]
