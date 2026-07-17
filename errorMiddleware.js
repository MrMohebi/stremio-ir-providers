export function createErrorHandler(logger = console) {
    return function errorHandler(error, req, res, next) {
        if (res.headersSent) {
            return next(error)
        }

        logger.error('Unhandled request error', {
            method: req.method,
            path: req.path,
            message: error?.message ?? String(error),
        })

        return res.status(500).json({error: 'Internal Server Error'})
    }
}
