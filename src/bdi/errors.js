class ConflictDetectedError extends Error {
  constructor(message = 'Friend collision detected') {
    super(message);
    this.name = 'ConflictDetectedError';
  }
}

export { ConflictDetectedError };
