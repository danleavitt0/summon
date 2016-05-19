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

/**
 * Middleware
 */

function middleware (stateKey = 'summon') {
  return ({dispatch, getState}) => next => action => {
    switch (action.type) {
      case subscribe.type: {
        if (paths.indexOf(action.payload) === -1) {
          paths.push(action.payload)
        }
      }
      break
      case unsubscribe.type: {
        const idx = paths.indexOf(action.payload)
        if (idx !== -1) {
          paths.splice(idx, 1)
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
              reducer,
              localInvalidate({key, cb: (err, val) => err ? reject(err) : resolve(val)})
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
