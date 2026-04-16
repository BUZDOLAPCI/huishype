const EMPTY_PERMISSIONS = Object.freeze({
  alert: false,
  badge: false,
  sound: false,
});

function remove() {}

const PushNotificationIOS = {
  FetchResult: {
    NewData: 'UIBackgroundFetchResultNewData',
    NoData: 'UIBackgroundFetchResultNoData',
    ResultFailed: 'UIBackgroundFetchResultFailed',
  },
  addEventListener() {
    return { remove };
  },
  removeEventListener() {},
  requestPermissions() {
    return Promise.resolve(EMPTY_PERMISSIONS);
  },
  abandonPermissions() {},
  checkPermissions(callback) {
    callback?.(EMPTY_PERMISSIONS);
  },
  getInitialNotification() {
    return Promise.resolve(null);
  },
  getAuthorizationStatus(callback) {
    callback?.(0);
  },
};

module.exports = PushNotificationIOS;
module.exports.default = PushNotificationIOS;
