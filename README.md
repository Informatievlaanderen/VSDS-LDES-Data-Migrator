# LDES Data Migrator
This tool allows to migrate the LDES member data from a LDES Server 2.x database to a LDES Server 3.x by directly reading the member data from a MongoDB document collection, using a Kafka topic as an intermediary storage for this member data and finally using the LDES Server's Kafka consumer capability to ingest the data members into its Postgres database.

This approach ensures that the Data Migrator and the LDES Server can both work on their own pace using the Kafka topic as a buffer.

## Docker
The tool can be run as a Docker container, using a pre-built container or after creating a Docker image for it locally. The Docker container will keep running until stopped if the Data Migrator is configured to run on a schedule, otherwise it will read all available data members, push them to the configured Kafka topic and then exit.


To create a Docker image, run the following command:
```bash
docker build . --tag vsds/ldes-data-migrator:latest
```

To run the Docker image, you need to provide a few mandatory environment variables (see [below](#run) for details) and then you can run it interactively, e.g. (obviously, the MongoDB and Kafka instance need to be running and the MongoDB database needs to exist):
```bash
docker run --rm -it -e KAFKAJS_NO_PARTITIONER_WARNING=1 \
-e MONGODB_URI=mongodb://localhost:27017 -e MONGODB_DATABASE=test \
-e KAFKA_BROKER=localhost:9092 -e KAFKA_TOPIC=test-ldes-members vsds/ldes-data-migrator:latest
```

## Build
The tool is implemented as a [Node.js](https://nodejs.org/en/) application.
You need to run the following commands to build it locally:
```bash
npm install
npm run build
```

## Run
The tool takes the following command line arguments:
* `--mongodb-uri=<connection-string>`, no default (to run against a local MongoDB use `mongodb://localhost:27017`)
* `--mongodb-database=<database-name>`, no default
* `--kafka-broker=<hostname:port>`, no default (to run against a local Kafka instance use something like `localhost:9092`)
* `--kafka-topic=<topic-name>`, no default
* `--silent=<true|false>` prevents any console debug output if true, defaults to `false` (not silent, logging debug info)
* `--schedule=<cron-specfication>`, defaults to the empty string resulting in a one-shot run
* `--chunk-size=<integer-number>`, defaults to `10000`

> **Notes:**
> * The MongoDB and Kafka arguments are mandatory.
> * The schedule arguments allows to run the Data Migrator on a configured schedule, each time processing the available data members. A scheduled run will verify if the previous run is still busy to ensure no simultaneous runs.
> * The chunk size allows to determine how many data members are loaded in memory from the document collection. Higher chunk sizes will require more memory.

You can run the tool providing one or more optional arguments after building it, e.g.:
```bash
node dist/server.js --chunk-size=5000 --mongodb-uri="mongodb://localhost:27017" --mongodb-database="test" --kafka-broker="localhost:9092" --kafka-topic="test-ldes-members"
```

If you want to process a large chunk size you may need to increase the memory available to the node.js process, e.g.:
```bash
NODE_OPTIONS=--max_old_space_size=5000 && node dist/server.js --chunk-size=500000 --mongodb-uri="mongodb://localhost:27017" --mongodb-database="test" --kafka-broker="localhost:9092" --kafka-topic="test-ldes-members"
```

### State Management
Because the MongoDB database may be very large the migration process may take a long time. In addition, due to network or system unavailability the migration process may be interrupted abnormally. To prevent data loss and to allow resuming the migration process the Data Migrator automatically stores its state (the last processed data member) in a state file named `state.json` located in `./data/` relative to the Data Migrator binary. E.g.:
```json
{ "lastSequenceNr": 152684 }
```

When running inside a cloud environment or a docker container, you need to use volume mapping to ensure this file survives between Data Migrator runs, e.g. (in a docker compose file):
```yaml
volumes:
  - ./data/migrator:/home/node/migrator/data:rw
```
