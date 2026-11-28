// Keeps the data in one JSON file (data/db.json), for running the tracker on your own computer.
const fs = require('fs');
const path = require('path');
const { newDb, upgradeDb } = require('./tracker');

function fileStore(dataDir) {
  const file = path.join(dataDir, 'db.json');
  let data;
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file); // atomic replace so a crash never leaves half a file
  };
  const load = () => {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dataDir, { recursive: true });
      data = newDb();
      console.log('No database found. Created one' + (process.env.NO_SEED ? '.' : ' with sample data.'));
      save();
    } else data = upgradeDb(JSON.parse(fs.readFileSync(file, 'utf8')));
  };
  load();
  return {
    file,
    async run(write, fn) {
      try {
        const result = await fn(data);
        if (write) save();
        return result;
      } catch (e) {
        load(); // throw away half-made changes
        throw e;
      }
    },
  };
}

module.exports = { fileStore };
