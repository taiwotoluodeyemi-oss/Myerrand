const mongoose = require('mongoose');

module.exports = () => {
  mongoose.set('strictQuery', false);

  mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('Mongo Error', err));
};
