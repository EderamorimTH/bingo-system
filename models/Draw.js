const mongoose = require('mongoose');


const DrawSchema = new mongoose.Schema({
numbers: [Number], // já sorteados, ordem
winners: [{ cardId: Number, playerName: String, playerPhone: String, prize: String }],
currentPrize: { type: String, default: '' }
});


module.exports = mongoose.model('Draw', DrawSchema);
