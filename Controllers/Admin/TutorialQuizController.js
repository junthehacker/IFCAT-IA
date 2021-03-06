/*------------------------------------
Controller for admin tutorial quiz management.

Author(s): Jun Zheng [me at jackzh dot com]
-------------------------------------*/

const Controller     = require('../Controller');
const TutorialQuiz   = require('../../Models/TutorialQuiz');
const asyncForEach   = require('../../Utils/asyncForEach');
const _              = require('lodash');
const getAbsUrl      = require('../../Utils/getAbsUrl');
const connectionPool = require('../../SocketIO/ConnectionPool').getInstance();

/**
 * Controller for admin tutorial quiz management.
 * @extends Controller
 * @memberOf Controller.AdminController
 */
class TutorialQuizController extends Controller {

    /**
     * List all tutorial quizzes.
     * This is the conduct quizzes page.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getTutorialsQuizzes(req, res, next) {
        try {
            await req.course.fillTutorials();
            let tutorials = req.course.tutorials.map(tutorial => tutorial.getId());
            let tutorialQuizzes = await TutorialQuiz.find({
                tutorialId: {$in: tutorials}
            }).populate('quiz');
            await asyncForEach(tutorialQuizzes, async (quiz) => {
                await quiz.fillTutorialFromRemote();
            });
            res.render('Admin/Pages/TutorialsQuizzes', {
                bodyClass: 'tutorials-quizzes-page',
                title: 'Conduct Quizzes',
                course: req.course,
                tutorialQuizzes
            });
        } catch (e) {
            next(e);
        }
    }

    /**
     * Update tutorial quizzes.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async editTutorialsQuizzes(req, res, next) {
        try {
            let items  = req.body.tutorialsQuizzes || [];
            let update = _.reduce(req.body.update, (obj, field) => {
                obj[field] = /^(published|active|archived)$/.test(field) ? !!req.body[field] : req.body[field];
                return obj;
            }, {});

            await asyncForEach(items, async (id) => {
                await TutorialQuiz.findByIdAndUpdate(id, update, {new: true});
                connectionPool.emitToRoom(`tutorialQuiz:${tutorialQuiz._id}`, 'QUIZ_STATUS_CHANGE', tutorialQuiz);
            });

            req.flash('success', 'List of quizzes have been updated.');
            res.redirect('back');
        } catch (e) {
            next(e);
        }
    }

    /**
     * Get one tutorial quiz.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async getTutorialQuiz(req, res, next) {
        try {
            await req.tutorialQuiz.populate([
                {path: 'quiz'},
                {path: 'groups'}
            ]).execPopulate();
            await req.tutorialQuiz.tutorial.fillStudentsFromRemote();
            res.render('Admin/Pages/TutorialQuiz', {
                bodyClass: 'tutorial-quiz-page',
                title: `Conduct ${req.tutorialQuiz.quiz.name} in ${req.tutorialQuiz.tutorial.getDisplayName()}`,
                course: req.course,
                tutorialQuiz: req.tutorialQuiz,
                tutorial: req.tutorialQuiz.tutorial,
                quiz: req.tutorialQuiz.quiz,
                students: _.map(req.tutorialQuiz.tutorial.getStudents(), student => _.omit(student.user, ['attributes'])),
                groups: _.sortBy(req.tutorialQuiz.groups, group => _.toInteger(group.name))
            });
        } catch (e) {
            next(e);
        }
    }

    /**
     * Update one tutorial quiz.
     * @param {Object} req Express request.
     * @param {Object} res Express response.
     * @param {function} next Next callback.
     * @returns {Promise<void>}
     */
    async editTutorialQuiz(req, res, next) {
        try {
            await req.tutorialQuiz.fillTutorialFromRemote();
            await req.tutorialQuiz.populate('quiz').execPopulate();

            // update tutorial-quiz
            await req.tutorialQuiz.set({
                allocateMembers: req.body.allocateMembers,
                maxMembersPerGroup: req.body.maxMembersPerGroup,
                published: !!req.body.published,
                active: !!req.body.active,
                archived: !!req.body.archived
            }).save();
            connectionPool.emitToRoom(`tutorialQuiz:${req.tutorialQuiz._id}`, 'QUIZ_STATUS_CHANGE', req.tutorialQuiz);
            req.flash('success', '<b>%s</b> settings have been updated for <b>TUT %s</b>.', req.tutorialQuiz.quiz.name, req.tutorialQuiz.tutorial.getDisplayName());
            res.redirect(getAbsUrl(`/admin/courses/${req.course.getId()}/tutorials-quizzes/${req.tutorialQuiz._id}`));
        } catch (e) {
            next(e);
        }
    }

}

module.exports = TutorialQuizController;
