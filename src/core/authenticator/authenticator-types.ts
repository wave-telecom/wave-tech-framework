export interface WaveAuthenticatorResult {
    token: string;
    expiresIn: number;
}

export interface WaveAuthenticator<T> {
    authenticate: (tokenIdentifier: T) => Promise<string>;
}

export interface WaveAuthenticatorParams {
    authUrl: string;
    audience: string;
    clientId: string;
    clientSecret: string;
}

export interface WaveAuthenticatorConfig {
    tokenExpiryInSeconds: number;
}
