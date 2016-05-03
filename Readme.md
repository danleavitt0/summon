
# summon

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

Summon data for your components

## Installation

    $ npm install vdux-summon

## Usage

vdux-summon is inspired by [react-refetch](https://github.com/heroku/react-refetch). You can use it to declaratively fetch data for your components and inject it into their props. You use it like this:

```javascript
function render ({props}) {
  return (
    <ul>
      {
        props.activities.value.map(activity => <li>{activity.displayName}</li>)
      }
    </ul>
  )
}
export default summon(props => ({
  'activities': `/user/${props.userId}/activities`
}), {
  render
})
```

Which you can then use like this:

`<Activities userId={currentUser.id} />`

## Descriptor object

The structure of descriptor objects is:

  * `url` - String, specifies the URL to fetch. If only a string is specified, it is shorthand for this.
  * `fragment` - See the pagination/cursor section.
  * `merge` - Define a custom merge function for fragments.

## Data object

The structure of a given object is:

  * `loading` - Whether or not the collection is currently loading
  * `loaded` - This is true any time after data has been loaded once. So if you are refetching, this remains true.
  * `error` - If an error has occurred, it is stored here.
  * `value` - The value returned from the request.
  * `url` - The url that was requested (minus any fragments)

## Refetching

Whenever the urls generated from props change, the data is refetched.

## Pagination/cursors

If you want to *add* to an existing collection, you can do so using fragments. Fragments are not diffed against the main url, so they do not invalidate the existing collection, and the result of requesting with a fragment will be merged into the existing collection (how this is done is configurable). Example:

```javascript
summon(props => ({
  'activities': `/user/${props.userId}/activities`,
  more: pageToken => ({
    activities: {
      fragment: `?pageToken=${pageToken}`
    }
  })
}), {
  render: function ({props}) {
    const {activities, more} = props
    const {value} = activities

    return (
      <div>
        <ul>
          {
            value.items.map(activity => <li>{activity.displayName}</li>)
          }
        </ul>
        <button onClick={() => more(value.pageToken)}>Load more</button>
      </div>
    )
  }
})
```

This will inject a `more` function into your props which you can call with a `pageToken` to generate a new `fragment`. The fragment will be appended to the existing URL for that collection and re-requested, with the result being merged into the existing collection.

## Invalidation & Subscription

A unique feature of vdux-summon is its invalidation/subscription capabilities. Each request descriptor may subscribe to a key or list of keys (it is automatically subscribed to the URL of the request). You may then trigger an invalidaton of these keys from elsewhere in the application. For example, consider a follow button:

```javascript
import summon from 'vdux-summon'

function render ({props}) {
  return (
    <Button onClick={followUser(props.userId)} disabled={props.isFollowing.value}>
      FollowUser
    </Button>
  )
}

export default summon(props => ({
  isFollowing: `/user/following/${props.userId}`
}), {
  render
})
```

This causes the current user to follow another. But what if there are disparate pieces of UI that rely on this information but have already loaded it? We want them to update too, and we want our button to automatically update itself to indicate that the user is already followed. Let's update our example to make that work:

```javascript
import summon, {invalidate} from 'vdux-summon'

function render ({props}) {
  return (
    <Button onClick={[followUser(props.userId), () => invalidate(`/user/following/${props.userId}`)]} disabled={props.isFollowing.value}>
      FollowUser
    </Button>
  )
}

export default summon(props => ({
  isFollowing: `/user/following/${props.userId}`
}), {
  render
})
```

Now not only will the follow button update, but *any* component that has summoned `/user/following/${props.userId}` will get refetched and rendered. This makes it easy to keep your data consistent across components.

### Middleware

In order to make this work however, you must install the summon middleware in your vdux middleware stack:

```javascript
import * as summon from 'vdux-summon'

vdux({
  middleware: [...middleware, summon.middleware]
})
```

### Custom invalidation keys

Sometimes you want to invalidate in broader strokes than particular urls, or otherwise decouple the invalidations from the endpoints that they request. To do this, you may add an `invalidate` key to your descriptor:

```javascript
summon(props => {
  feed: {
    url: `/user/following/${props.userId}`,
    invalidate: 'feed update'
  }
})
```

Then somewhere else:

```javascript
import io from 'socket.io'
import vdux from 'vdux'

const socket = io()

// ... setup vdux...

socket.on('feed update', msg => dispatch(invalidate('feed update')))
```

## License

MIT
