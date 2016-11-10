/**
 * Imports
 */

import {toEphemeral} from 'redux-ephemeral'
import createAction from '@f/create-action'
import {reducer} from '.'
import map from '@f/map'

/**
 * Actions
 */

const subscribe = createAction('vdux-summon: subscribe')
const unsubscribe = createAction('vdux-summon: unsubscribe')
const invalidate = createAction('vdux-summon: invalidate')
const localInvalidate = createAction('vdux-summon: local invalidate')

/**
 * Component paths
 */

const paths = []
const reducers = {}

/**
 * Middleware
 */

function middleware ({dispatch}) {
  return next => action => {
    switch (action.type) {
      case subscribe.type: {
        const {path, reducer} = action.payload
        if (paths.indexOf(path) === -1) {
          paths.push(path)
          reducers[path] = reducer
        }
      }
      break
      case unsubscribe.type: {
        const path = action.payload
        const idx = paths.indexOf(path)
        if (idx !== -1) {
          paths.splice(idx, 1)
          delete reducers[path]
        }
      }
      break
      // Invalidate a key and re-render the components that
      // depend on it
      case invalidate.type: {
        const key = action.payload

        return Promise.all(map(
          path => new Promise((resolve, reject) => dispatch(
            toEphemeral(
              path,
              reducers[path],
              localInvalidate([key, (err, val) => err ? reject(err) : resolve(val)])
            )
          )),
          paths
        ))
      }
      break
      default:
        return next(action)
    }
  }
}

/**
 * Exports
 */

export default middleware
export {
  subscribe,
  unsubscribe,
  invalidate,
  localInvalidate
}
