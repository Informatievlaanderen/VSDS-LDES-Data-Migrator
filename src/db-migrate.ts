import minimist from 'minimist'
import { Collection, MongoClient } from 'mongodb';
import { Kafka } from 'kafkajs';
import { CronJob } from 'cron';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

let lastSequenceNr = 0;

interface Member {
  sequenceNr: number,
  collectionName: string,
  model: string,
}

const args = minimist(process.argv.slice(2));
const silent: boolean = (/true/i).test(args['silent']);
if (!silent) {
  console.debug("Arguments: ", args);
}

function exitWithError(error: any) {
  console.error('[ERROR] ', error);
  process.exit(1);
}

const schedule = args['schedule'] || '';
const chunkSize = Number.parseInt(args['chunk-size'] || '10000');

const mongodbUri = args['mongodb-uri'];
if (!mongodbUri) {
  exitWithError('missing value for mandatory argument "--mongodb-uri".');
}

const database = args['mongodb-database'];
if (!database) {
  exitWithError('missing value for mandatory argument "--mongodb-database".');
}

const mongo = new MongoClient(mongodbUri);

const kafkaBroker = args['kafka-broker'];
if (!kafkaBroker) {
  exitWithError('missing value for mandatory argument "--kafka-broker".');
}

const kafkaTopic = args['kafka-topic'];
if (!kafkaTopic) {
  exitWithError('missing value for mandatory argument "--kafka-topic".');
}

const kafka = new Kafka({
  clientId: `${database}-migrator`,
  brokers: [kafkaBroker]
})
const producer = kafka.producer();

interface State {
  lastSequenceNr: number,
}

const stateFile = './data/state.json';

async function readState() {
  const data = await readFile(stateFile, { encoding: 'utf8' });
  const state = JSON.parse(data) as State;
  lastSequenceNr = state.lastSequenceNr;
}

async function writeState() {
  const data = JSON.stringify({ lastSequenceNr: lastSequenceNr });
  await writeFile(stateFile, data, { encoding: 'utf8' });
}

async function setup() {
  await producer.connect();
  await mongo.connect();
}

async function teardown() {
  await mongo.close();
  await producer.disconnect();
  await writeState();
}

process.on('SIGINT', closeGracefully);

async function closeGracefully(signal: any) {
  if (!silent) {
    console.debug(`Received signal: `, signal);
  }
  await teardown();
  process.exitCode = 0;
}

async function processMembers(collection: Collection<Member>) {
  let done = false;
  let total = 0;

  while (!done) {
    const startTime = new Date().getTime();
    const cursor = collection.find(
      { sequenceNr: { $gt: lastSequenceNr } },
      { sort: { sequenceNr: 1 }, limit: chunkSize }
    );
    try {
      const members = await cursor.toArray();
      const elapsedTime = new Date().getTime();
      const count = members.length;
      for (let index = 0; index < members.length; index++) {
        const x = members[index]!;
        await producer.send({ topic: kafkaTopic, messages: [{ value: x.model }] });
        lastSequenceNr = x.sequenceNr;
      };
      const endTime = new Date().getTime();
      const fetchDuration = elapsedTime - startTime;
      const sendDuration = endTime - elapsedTime;
      const totalDuration = endTime - startTime;
      const message = count > 0
        ? `Processed ${count} members in ${totalDuration} ms (read MongoDB: ${fetchDuration} ms, write Kafka: ${sendDuration} ms)`
        : `No members processed in ${totalDuration} ms`;
      console.log(message);
      done = (count < chunkSize);
      total += count;
    } finally {
      cursor.close();
      await writeState();
    }
  }
  return total;
}

let running = false;

async function doWork() {
  if (!running) {
    try {
      try {
        running = true;
        await setup();
        const startTime = new Date().getTime();
        const collection = mongo.db(database).collection<Member>('ingest_ldesmember');
        const count = await processMembers(collection);
        const endTime = new Date().getTime();
        console.info(`Processed ${count} members in ${endTime - startTime} ms`);
      } finally {
        await teardown();
        running = false;
      }
    } catch (error) {
      exitWithError(error);
    }
  }
}


if (existsSync(stateFile)) {
  await readState();
  if (!silent) {
    console.debug("Using lastSequenceNr from state: ", lastSequenceNr);
  }
}

if (schedule) {
  const job = new CronJob(schedule, async () => doWork());
  if (!silent) console.info('Runs at: ', schedule);
  job.start();
} else {
  doWork();
}
