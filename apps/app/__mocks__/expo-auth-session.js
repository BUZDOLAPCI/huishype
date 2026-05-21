class AuthRequest {
  constructor(config) {
    this.config = config;
  }

  async promptAsync() {
    return { type: 'dismiss' };
  }
}

module.exports = {
  AuthRequest,
  ResponseType: {
    IdToken: 'id_token',
  },
  makeRedirectUri: jest.fn(() => 'huishype://auth/callback'),
};
