"""
Description: Authenticates a user and returns JWT access and refresh tokens.
Drivers:
    mongodb (required): Queries the users collection to validate credentials.

Dynamic:
    None

Args:
    None

Body:
    {
        "username": str,  # Required
        "password": str   # Required (plain text, hashed with SHA-256 before comparison)
    }

Response:
    200: { "message": str, "tokens": { "access_token": str, "refresh_token": str } }
    400: { "error": str }
    401: { "error": str }
"""

import logging

import jwt

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import memberships, passwords
from system.modules.Mongodb import MongodbConnector
from system.modules.jwt_generator import JwtGenerator, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY


class Login(ApiPluginInterface):
    def __init__(self, params: dict | None = None):
        super().__init__(params)
        self._log = logging.getLogger(self.__class__.__name__)
        self.mongodb: MongodbConnector = self.params.get('drivers', {}).get('mongodb')
        self._jwt = self.params.get('jwt', {}) or {}

    def _signing_secret(self) -> str:
        secret = self._jwt.get('secret_key')
        if not secret:
            raise RuntimeError("JWT signing secret is not configured")
        return secret

    def _issue(self, user: dict) -> dict:
        return JwtGenerator.generate_tokens(
            subject=user.get('username'),
            organization_id=str(user.get('organization_id')),
            properties=user.get('properties', {}),
            secret=self._signing_secret(),
            issuer=self._jwt.get('issuer'),
            token_version=int(user.get('token_version', 0)),
            access_token_expiry=int(self._jwt.get('access_token_expiry_seconds', ACCESS_TOKEN_EXPIRY)),
            refresh_token_expiry=int(self._jwt.get('refresh_token_expiry_seconds', REFRESH_TOKEN_EXPIRY)),
        )

    def _active_user(self, username: str) -> dict | None:
        if not username:
            return None
        user = self.mongodb.get_collection('users').find_one({"username": username})
        return user

    def login(self, json_data: dict):
        username = json_data.get('username')
        password = json_data.get('password')

        if not username or not password:
            return {"error": "Username and password are required"}, 400

        user = self._active_user(username)
        if (not user or (user.get('properties') or {}).get('account_type') == 'service'
                or not passwords.verify_password(user.get('password', ''), password)):
            self._log.warning(f"Failed login for username={username}")
            return {"error": "Invalid username or password"}, 401

        if user.get('disabled', False):
            return {"error": "Account is disabled"}, 403

        self._log.info("Account login successful for username=%s", username)
        return {
            "message": "Login successful",
            "account_token": memberships.account_token(user, self._jwt),
            "username": user.get('username'),
        }, 200

    def refresh(self, json_data: dict):
        refresh_token = json_data.get('refresh_token')

        if not refresh_token:
            return {"error": "Refresh token is required"}, 400

        try:
            payload = JwtGenerator.decode(refresh_token, self._signing_secret(), self._jwt.get('issuer'), "refresh")
        except jwt.PyJWTError:
            self._log.warning("Refresh rejected: invalid or expired refresh token")
            return {"error": "Invalid refresh token"}, 401

        user = self._active_user(payload.get('sub'))
        if not memberships.token_valid(self.mongodb, user, payload):
            return {"error": "Invalid refresh token"}, 401

        self._log.info(f"Refresh successful for username={user.get('username')}")
        return {"message": "Authentication successful", "tokens": memberships.issue_tokens(
            self.mongodb, user, payload["organization_id"], self._jwt)}, 200

    def run(self, params: dict | None = None):
        kwargs = params.get('kwargs', {})
        json_data = params.get('json', {})
        dynamic = kwargs.get('dynamic', [])

        if len(dynamic) > 0 and dynamic[0] == 'refresh':
            return self.refresh(json_data)

        return self.login(json_data)
