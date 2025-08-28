const mongoose = require('mongoose');


const PlayerSchema = new mongoose.Schema({
name: String,
phone: String,
cardIds: [Number]
});


module.exports = mongoose.model('Player', PlayerSchema);
