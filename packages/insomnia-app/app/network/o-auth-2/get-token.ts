import * as models from '../../models';
import type { OAuth2Token } from '../../models/o-auth-2-token';
import type { RequestAuthentication } from '../../models/request';
import {
  GRANT_TYPE_AUTHORIZATION_CODE,
  GRANT_TYPE_CLIENT_CREDENTIALS,
  GRANT_TYPE_IMPLICIT,
  GRANT_TYPE_PASSWORD,
  P_ACCESS_TOKEN,
  P_ERROR,
  P_ERROR_DESCRIPTION,
  P_ERROR_URI,
  P_EXPIRES_IN,
  P_ID_TOKEN,
  P_REFRESH_TOKEN,
  X_ERROR,
  X_RESPONSE_ID,
} from './constants';
import getAccessTokenAuthorizationCode from './grant-authorization-code';
import getAccessTokenClientCredentials from './grant-client-credentials';
import getAccessTokenImplicit from './grant-implicit';
import getAccessTokenPassword from './grant-password';
import refreshAccessToken from './refresh-token';
/** Get an OAuth2Token object and also handle storing/saving/refreshing */

export default async function(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh = false,
): Promise<OAuth2Token | null> {
  switch (authentication.grantType) {
    case GRANT_TYPE_AUTHORIZATION_CODE:
      return _getOAuth2AuthorizationCodeHeader(requestId, authentication, forceRefresh);

    case GRANT_TYPE_CLIENT_CREDENTIALS:
      return _getOAuth2ClientCredentialsHeader(requestId, authentication, forceRefresh);

    case GRANT_TYPE_IMPLICIT:
      return _getOAuth2ImplicitHeader(requestId, authentication, forceRefresh);

    case GRANT_TYPE_PASSWORD:
      return _getOAuth2PasswordHeader(requestId, authentication, forceRefresh);

    default:
      return null;
  }
}

async function _getOAuth2AuthorizationCodeHeader(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  const oAuth2Token = await _getAccessToken(requestId, authentication, forceRefresh);

  if (oAuth2Token) {
    return oAuth2Token;
  }

  const results = await getAccessTokenAuthorizationCode(
    requestId,
    authentication.authorizationUrl,
    authentication.accessTokenUrl,
    authentication.credentialsInBody,
    authentication.clientId,
    authentication.clientSecret,
    authentication.redirectUrl,
    authentication.scope,
    authentication.state,
    authentication.audience,
    authentication.resource,
    authentication.usePkce,
    authentication.pkceMethod,
  );
  return _updateOAuth2Token(requestId, results);
}

async function _getOAuth2ClientCredentialsHeader(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  const oAuth2Token = await _getAccessToken(requestId, authentication, forceRefresh);

  if (oAuth2Token) {
    return oAuth2Token;
  }

  const results = await getAccessTokenClientCredentials(
    requestId,
    authentication.accessTokenUrl,
    authentication.credentialsInBody,
    authentication.clientId,
    authentication.clientSecret,
    authentication.scope,
    authentication.audience,
    authentication.resource,
  );
  return _updateOAuth2Token(requestId, results);
}

async function _getOAuth2ImplicitHeader(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  const oAuth2Token = await _getAccessToken(requestId, authentication, forceRefresh);

  if (oAuth2Token) {
    return oAuth2Token;
  }

  const results = await getAccessTokenImplicit(
    requestId,
    authentication.authorizationUrl,
    authentication.clientId,
    authentication.responseType,
    authentication.redirectUrl,
    authentication.scope,
    authentication.state,
    authentication.audience,
  );
  return _updateOAuth2Token(requestId, results);
}

async function _getOAuth2PasswordHeader(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  const oAuth2Token = await _getAccessToken(requestId, authentication, forceRefresh);

  if (oAuth2Token) {
    return oAuth2Token;
  }

  const results = await getAccessTokenPassword(
    requestId,
    authentication.accessTokenUrl,
    authentication.credentialsInBody,
    authentication.clientId,
    authentication.clientSecret,
    authentication.username,
    authentication.password,
    authentication.scope,
    authentication.audience,
  );
  return _updateOAuth2Token(requestId, results);
}

async function _getAccessToken(
  requestId: string,
  authentication: RequestAuthentication,
  forceRefresh: boolean,
): Promise<OAuth2Token | null> {
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // See if we have a token already //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  const token: OAuth2Token | null = await models.oAuth2Token.getByParentId(requestId);

  if (!token) {
    return null;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // Check if the token needs refreshing //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // Refresh tokens are part of Auth Code, Password
  const expiresAt = token.expiresAt || Infinity;
  const isExpired = Date.now() > expiresAt;

  if (!isExpired && !forceRefresh) {
    return token;
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // Refresh the token if necessary //
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ //
  // We've expired, but don't have a refresh token, so tell caller to fetch new
  // access token
  if (!token.refreshToken) {
    return null;
  }

  const refreshResults = await refreshAccessToken(
    requestId,
    authentication.accessTokenUrl,
    authentication.credentialsInBody,
    authentication.clientId,
    authentication.clientSecret,
    token.refreshToken,
    authentication.scope,
  );

  // If we didn't receive an access token it means the refresh token didn't succeed,
  // so we tell caller to fetch brand new access and refresh tokens.
  if (!refreshResults.access_token) {
    return null;
  }

  // ~~~~~~~~~~~~~ //
  // Update the DB //
  // ~~~~~~~~~~~~~ //
  return _updateOAuth2Token(requestId, refreshResults);
}

async function _updateOAuth2Token(
  requestId: string,
  authResults: Record<string, any>,
): Promise<OAuth2Token> {
  const oAuth2Token = await models.oAuth2Token.getOrCreateByParentId(requestId);
  // Calculate expiry date
  const expiresIn = authResults[P_EXPIRES_IN];
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
  return models.oAuth2Token.update(oAuth2Token, {
    expiresAt,
    refreshToken: authResults[P_REFRESH_TOKEN] || null,
    accessToken: authResults[P_ACCESS_TOKEN] || null,
    identityToken: authResults[P_ID_TOKEN] || null,
    error: authResults[P_ERROR] || null,
    errorDescription: authResults[P_ERROR_DESCRIPTION] || null,
    errorUri: authResults[P_ERROR_URI] || null,
    // Special Cases
    xResponseId: authResults[X_RESPONSE_ID] || null,
    xError: authResults[X_ERROR] || null,
  });
}
