/*------------------------------------
Controller for admin quiz response management.

Author(s): Jun Zheng [me at jackzh dot com]
-------------------------------------*/

const Controller   = require('../Controller');
const _            = require('lodash');
const async        = require('async');
const csv          = require('csv');
const models       = require('../../Models');
const TutorialQuiz = require('../../Models/TutorialQuiz');
const asyncForEach = require('../../Utils/asyncForEach');

/**
 * Controller for admin quiz response management.
 * @extends Controller
 * @memberOf Controller.AdminController
 */
class ResponseController extends Controller {
    /**
     * Get group response.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getResponses(req, res, next) {
        // get members, questions, and responses
        async.series([
            done => {
                req.tutorialQuiz.populate({
                    path: 'quiz',
                    model: 'Quiz',
                    select: 'questions',
                    populate: {
                        path: 'questions',
                        model: 'Question',
                        select: 'number type question code choices answers',
                        match: {
                            $or: [
                                {submitter: {$exists: false}},
                                {submitter: {$exists: true}, approved: true}
                            ]
                        }
                    }
                }, done)
            },
            done => {
                let ids = req.tutorialQuiz.quiz ? _.map(req.tutorialQuiz.quiz.questions, '_id') : [];
                req.group.populate([{
                    path: 'members',
                    model: 'User',
                    select: 'name',
                    options: {
                        sort: 'name.first name.last'
                    }
                }, {
                    path: 'responses',
                    model: 'Response',
                    match: {
                        question: {$in: ids}
                    }
                }], done)
            }
        ], err => {
            if (err)
                return next(err);
            let questions = req.tutorialQuiz.quiz.questions,
                responses = req.group.responses;
            // organize results
            questions     = _.map(questions, question => {
                // find response for question
                let response = _.find(responses, response => response.question.equals(question._id));
                // if none, create a dummy one
                if (!response)
                    response = new models.Response();

                question.response = response;
                question.score    = response.points || 0;
                // compare expected answer w/ given answer
                switch (question.type) {
                    case 'multiple choice':
                    case 'multiple select':
                        question.results = _.map(question.choices, choice => {
                            let expected = question.isAnswer(choice),
                                given    = response.isAnswer(choice);
                            return {
                                choice: choice,
                                expected: expected,
                                given: given,
                                correct: (expected && given || (expected !== given ? false : null))
                            };
                        });
                        break;
                    case 'short answer':
                        let given        = response.answer[0];
                        question.results = {
                            expected: question.answers,
                            given: given,
                            correct: question.isAnswer(given)
                        };
                        break;
                    case 'code tracing':
                        question.results = _.map(question.answers, (answer, i) => {
                            let codeTracingAnswer = response.lineByLineSummary && response.lineByLineSummary[i] ? response.lineByLineSummary[i].value : null,
                                lineByLineSummary = response.lineByLineSummary ? response.lineByLineSummary[i] : null,
                                attempts          = lineByLineSummary ? lineByLineSummary.attempts : 0,
                                correct           = lineByLineSummary ? lineByLineSummary.correct : false;

                            return {
                                expected: answer,
                                given: codeTracingAnswer,
                                attempts: attempts,
                                correct: answer == codeTracingAnswer
                            };
                        });
                        break;
                    default:
                        break;
                }
                return question;
            });

            res.render('Admin/Pages/GroupResponses', {
                mathjax: true,
                bodyClass: 'responses-page',
                title: 'Responses',
                course: req.course,
                tutorialQuiz: req.tutorialQuiz,
                group: req.group,
                questions: questions
            });
        });
    };

    /**
     * Add a new response.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async addResponse(req, res, next) {
        let response = new models.Response(req.body);
        models.Question.findById(req.body.question, 'number type answers', (err, question) => {
            if (err)
                return next(err);
            // check answers
            if (question.isMultipleChoice() || question.isMultipleSelect()) {
                // correct if all answers were selected
                response.correct = _.isEqual(question.answers.sort(), response.answer.sort());
            } else if (question.isShortAnswer()) {
                // normalize answers
                if (!question.caseSensitive) {
                    question.answers = _.map(question.answers, answer => _.toLower(answer));
                    response.answer  = _.map(response.answer, answer => _.toLower(answer));
                }
                // correct if one of the answers was selected
                response.correct = _.intersection(question.answers, response.answer).length > 0;
            } else if (question.isCodeTracing()) {
                // correct if all answers were selected
                response.correct = _.isEqual(question.answers, _.map(response.lineByLineSummary, line => line.value.trim()));
            }
            response.group = req.group._id;
            response.save(err => {
                if (err)
                    return next(err);
                req.flash('success', 'Response for question <b>%s</b> has been updated.', question.number);
                res.redirect('back');
            });
        });
    }

    /**
     * Edit a response.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async editResponse(req, res, next) {
        async.series([
            done => models.Question.findById(req.body.question, 'number type answers caseSensitive', done),
            done => models.Response.findById(req.params.response, done)
        ], (err, results) => {
            if (err)
                return next(err);
            let [question, response] = results;

            response.group  = req.group._id;
            response.answer = [];
            response.set(req.body);
            // check answers
            if (question.isMultipleChoice() || question.isMultipleSelect()) {
                // correct if all answers were selected
                response.correct = _.isEqual(question.answers.sort(), response.answer.sort());
            } else if (question.isShortAnswer()) {
                // normalize answers
                if (!question.caseSensitive) {
                    question.answers = _.map(question.answers, answer => _.toLower(answer));
                    response.answer  = _.map(response.answer, answer => _.toLower(answer));
                }
                // correct if one of the answers was selected
                response.correct = _.intersection(question.answers, response.answer).length > 0;
            } else if (question.isCodeTracing()) {
                // correct if all answers were selected
                response.correct = _.isEqual(question.answers, _.map(response.lineByLineSummary, line => line.value.trim()));
            }

            response.save(err => {
                if (err)
                    return next(err);
                req.flash('success', 'Response for question <b>%s</b> has been updated.', question.number);
                res.redirect('back');
            });
        });
    }

    /**
     * Get student's mark.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getMarksByStudent(req, res, next) {
        models.TutorialQuiz.aggregate([{
            $match: {tutorial: {$in: req.course.tutorials}}
        }, {
            $lookup: {from: 'tutorials', localField: 'tutorial', foreignField: '_id', as: 'tutorial'}
        }, {
            $unwind: '$tutorial'
        }, {
            $lookup: {from: 'quizzes', localField: 'quiz', foreignField: '_id', as: 'quiz'}
        }, {
            $unwind: '$quiz'
        }, {
            $unwind: '$groups'
        }, {
            $lookup: {from: 'groups', localField: 'groups', foreignField: '_id', as: 'group'}
        }, {
            $unwind: '$group'
        }, {
            $match: {'group.members': {$in: [req.student._id]}}
        }, {
            $lookup: {from: 'responses', localField: 'group._id', foreignField: 'group', as: 'response'}
        }, {
            $unwind: {path: '$response', preserveNullAndEmptyArrays: true}
        }, {
            $group: {
                _id: '$_id',
                tutorial: {$first: '$tutorial'},
                quiz: {$first: '$quiz'},
                group: {$first: '$group'},
                totalPoints: {$sum: '$response.points'}
            }
        }], (err, tutorialQuizzes) => {
            if (err)
                return next(err);
            res.render('Admin/Pages/StudentMarks', {
                title: 'Marks',
                course: req.course,
                student: req.student,
                tutorialQuizzes: tutorialQuizzes,
                totalPoints: _.sumBy(tutorialQuizzes, tutorialQuiz => tutorialQuiz.totalPoints)
            });
        });
    }

    /**
     * Get all marks within a quiz instance.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getMarksByTutorialQuiz(req, res, next) {

        const UTORID_KEY = 'urn:oid:1&#463&#466&#461&#464&#461&#4615465&#463&#461&#468';

        await req.tutorialQuiz.populate('quiz groups').execPopulate();
        await asyncForEach(req.tutorialQuiz.groups, async group => {
            await group.populate('responses').execPopulate();
            await group.fillMembersFromRemote();
        });
        await req.tutorialQuiz.quiz.populate('questions').execPopulate();

        let data = [];

        await asyncForEach(req.tutorialQuiz.groups, async group => {
            let groupScore = 0;
            let groupResult = [];
            await asyncForEach(req.tutorialQuiz.quiz.questions, async question => {
                await asyncForEach(group.responses, async response => {
                    if(response.question.toString() === question._id.toString()) {
                        groupResult.push(response.points);
                    }
                });
            });
            await asyncForEach(group.responses, async response => {
                groupScore += response.points;
            });
            group.members.forEach(member => {
                let memberData = {
                    score: groupScore,
                    member: member,
                    group: group,
                    utorid: member.user.attributes ? JSON.parse(member.user.attributes[UTORID_KEY]) : "",
                    quiz: req.tutorialQuiz.quiz,
                    tutorial: req.tutorialQuiz.tutorial,
                    groupResult: groupResult,
                };
                data.push(memberData);
            });
        });

        let questionHeadings = [];
        await asyncForEach(req.tutorialQuiz.quiz.questions, async (question, key) => {
            questionHeadings.push(`Q${question.number} [${key}]`);
        });


        if (req.query.export === 'true') {
            data = _.map(data, d => [
                d.member.getUsername(),
                d.member.user.attributes ? JSON.parse(d.member.user.attributes[UTORID_KEY]) : "",
                d.quiz.name,
                d.tutorial.getDisplayName(),
                d.group.name,
                d.score,
                ...d.groupResult,
            ]);
            data.unshift(['Username', 'UTORid', 'Quiz', 'Tutorial', 'Group', 'Mark', ...questionHeadings]);
            res.setHeader('Content-disposition', 'attachment; filename=marks.csv');
            res.set('Content-Type', 'text/csv');

            return csv.stringify(data, (err, output) => {
                if (err)
                    return next(err);
                return res.send(output);
            });
        } else {
            res.render('Admin/Pages/TutorialQuizMarks', {
                title: 'Marks',
                course: req.course,
                tutorialQuiz: req.tutorialQuiz,
                data
            });
        }


        // models.TutorialQuiz.aggregate([{
        //     $match: {_id: req.tutorialQuiz._id} // DONE
        // }, {
        //     $lookup: {from: 'tutorials', localField: 'tutorial', foreignField: '_id', as: 'tutorial'} // FILLED
        // }, {
        //     $unwind: '$tutorial' // FILLED
        // }, {
        //     $lookup: {from: 'quizzes', localField: 'quiz', foreignField: '_id', as: 'quiz'} // FILLED
        // }, {
        //     $unwind: '$quiz' // FILLED
        // }, {
        //     $unwind: '$groups' // FILLED
        // }, {
        //     $lookup: {from: 'groups', localField: 'groups', foreignField: '_id', as: 'group'} // FILLED
        // }, {
        //     $unwind: '$group' // FILLED
        // }, {
        //     $unwind: '$group.members' // FILLED
        // }, {
        //     $lookup: {from: 'users', localField: 'group.members', foreignField: '_id', as: 'member'} // FILLED
        // }, {
        //     $unwind: '$member' // FILLED
        // }, {
        //     $lookup: {from: 'responses', localField: 'group._id', foreignField: 'group', as: 'response'} // FILLED
        // }, {
        //     $unwind: {path: '$response', preserveNullAndEmptyArrays: true} // FILLED
        // }, {
        //     $group: {
        //         _id: '$member._id',
        //         tutorial: {$first: '$tutorial'},
        //         quiz: {$first: '$quiz'},
        //         member: {$first: '$member'},
        //         group: {$first: '$group'},
        //         totalPoints: {$sum: '$response.points'}
        //     }
        // }, {
        //     $sort: {_id: 1}
        // }], (err, data) => {
        //     if (err)
        //         return next(err);
        //     // export marks into CSV
        //     if (req.query.export === 'true') {
        //         data = _.map(data, d => [
        //             d.member.UTORid,
        //             d.member.studentNumber,
        //             `${d.member.name.first} ${d.member.name.last}`,
        //             d.tutorial.number,
        //             d.quiz.name,
        //             d.group.name,
        //             d.totalPoints
        //         ]);
        //         // set headings
        //         data.unshift(['UTORid', 'Student No.', 'Name', 'Tutorial', 'Quiz', 'Group', 'Mark']);
        //         // send CSV
        //         res.setHeader('Content-disposition', 'attachment; filename=marks.csv');
        //         res.set('Content-Type', 'text/csv');
        //         return csv.stringify(data, (err, output) => {
        //             if (err)
        //                 return next(err);
        //             return res.send(output);
        //         });
        //     }
        //
        //     res.render('Admin/Pages/TutorialQuizMarks', {
        //         title: 'Marks',
        //         course: req.course,
        //         tutorialQuiz: req.tutorialQuiz,
        //         data: data
        //     });
        // });
    }

    /**
     * Get all marks within a course.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getMarksByCourse(req, res, next) {

        let tutorialQuizzes = await TutorialQuiz.find({_id: {$in: req.body.tutorialQuizzes || []}});

        await asyncForEach(tutorialQuizzes, async tutorialQuiz => {
            await tutorialQuiz.populate('quiz groups').execPopulate();
            await tutorialQuiz.fillTutorialFromRemote();
            await asyncForEach(tutorialQuiz.groups, async group => {
                await group.populate('responses').execPopulate();
                await group.fillMembersFromRemote();
            });
        });

        let data = [];

        for(let tutorialQuiz of tutorialQuizzes) {
            tutorialQuiz.groups.forEach(group => {
                let groupScore = 0;
                group.responses.forEach(response => {
                    groupScore += response.points;
                });
                group.members.forEach(member => {
                    let memberData      = {};
                    memberData.score    = groupScore; // Individual score is the group score.
                    memberData.member   = member;
                    memberData.group    = group;
                    memberData.quiz     = tutorialQuiz.quiz;
                    memberData.tutorial = tutorialQuiz.tutorial;
                    data.push(memberData);
                });
            });
        }

        if (req.query.export === 'true') {
            data = _.map(data, d => [
                d.member.getUsername(),
                d.quiz.name,
                d.tutorial.getDisplayName(),
                d.group.name,
                d.score
            ]);
            data.unshift(['Username', 'Quiz', 'Tutorial', 'Group', 'Mark']);
            res.setHeader('Content-disposition', 'attachment; filename=marks.csv');
            res.set('Content-Type', 'text/csv');

            return csv.stringify(data, (err, output) => {
                if (err)
                    return next(err);
                return res.send(output);
            });
        } else {
            res.redirect('back');
        }


        // models.TutorialQuiz.aggregate([{
        //     $match: {_id: {$in: req.body.tutorialQuizzes || []}}
        // }, {
        //     $lookup: {from: 'tutorials', localField: 'tutorial', foreignField: '_id', as: 'tutorial'}
        // }, {
        //     $unwind: '$tutorial'
        // }, {
        //     $lookup: {from: 'quizzes', localField: 'quiz', foreignField: '_id', as: 'quiz'}
        // }, {
        //     $unwind: '$quiz'
        // }, {
        //     $unwind: '$groups'
        // }, {
        //     $lookup: {from: 'groups', localField: 'groups', foreignField: '_id', as: 'group'}
        // }, {
        //     $unwind: '$group'
        // }, {
        //     $unwind: '$group.members'
        // }, {
        //     $lookup: {from: 'users', localField: 'group.members', foreignField: '_id', as: 'member'}
        // }, {
        //     $unwind: '$member'
        // }, {
        //     $lookup: {from: 'responses', localField: 'group._id', foreignField: 'group', as: 'response'}
        // }, {
        //     $unwind: {path: '$response', preserveNullAndEmptyArrays: true}
        // }, {
        //     $group: {
        //         _id: {tutorialQuiz: '_id', member: '$member._id'},
        //         tutorial: {$first: '$tutorial'},
        //         quiz: {$first: '$quiz'},
        //         group: {$first: '$group'},
        //         member: {$first: '$member'},
        //         totalPoints: {$sum: '$response.points'}
        //     }
        // }, {
        //     $sort: {'member.UTORid': 1, 'tutorialQuiz.quiz.name': 1}
        // }], (err, data) => {
        //     if (err)
        //         return next(err);
        //     // export marks into CSV
        //     if (req.query.export === 'true') {
        //         data = _.map(data, d => [
        //             d.member.UTORid,
        //             d.member.studentNumber,
        //             `${d.member.name.first} ${d.member.name.last}`,
        //             d.tutorial.number,
        //             d.quiz.name,
        //             d.group.name,
        //             d.totalPoints
        //         ]);
        //         // set headings
        //         data.unshift(['UTORid', 'Student No.', 'Name', 'Tutorial', 'Quiz', 'Group', 'Mark']);
        //         // send CSV
        //         res.setHeader('Content-disposition', 'attachment; filename=marks.csv');
        //         res.set('Content-Type', 'text/csv');
        //         return csv.stringify(data, (err, output) => {
        //             if (err)
        //                 return next(err);
        //             return res.send(output);
        //         });
        //     }
        //     res.redirect('back');
        // });
    }
}


module.exports = ResponseController;
