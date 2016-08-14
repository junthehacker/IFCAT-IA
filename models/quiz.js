var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var QuizSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    questions: [ { type: Schema.Types.ObjectId, ref : 'Question' } ],
    randomizeChoices: Boolean,
    availableToAll: { type: Boolean, default: False }
    availableTo: [ { type: Schema.Types.ObjectId, ref : 'Tutorial' } ], // complete
    scoreByAttempt : [ Number ],  // score to assign if student answers correctly on (i + 1)th attempt (i being index)
    groupRsponses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GroupResponse' }],
    responses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Response' }],
}, {
    timestamps: true
});

module.exports = mongoose.model('Quiz', QuizSchema);
