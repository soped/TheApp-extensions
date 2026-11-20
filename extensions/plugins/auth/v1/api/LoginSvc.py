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

from system.interfaces.api_plugin_interface import ApiPluginInterface
from system.modules import passwords
from system.modules.Mongodb import MongodbConnector
from system.modules.jwt_generator import JwtGenerator, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY


class LoginSvc(ApiPluginInterface):
    def __init__(self, params: dict | None = None):
        super().__init__(params)
        self._log = logging.getLogger(self.__class__.__name__)
        self.mongodb: MongodbConnector = self.params.get('drivers', {}).get('mongodb')
        self._jwt = self.params.get('jwt', {}) or {}

    def run(self, params: dict | None = None):
        json_data = params.get('json', {})

        username = json_data.get('username')
        auth_key = json_data.get('auth_key')

        if not username or not auth_key:
            return {"error": "Username and auth_key are required"}, 400

        secret = self._jwt.get('secret_key')
        if not secret:
            raise RuntimeError("JWT signing secret is not configured")

        user = self.mongodb.get_collection('users').find_one({"username": username, "properties.account_type": "service"})
        if not user or not user.get('organization_id') or not passwords.verify_password(user.get('auth_key', ''), auth_key):
            self._log.warning(f"Failed service login for username={username}")
            return {"error": "Invalid username or auth key"}, 401

        if user.get('disabled', False):
            return {"error": "Account is disabled"}, 403

        organization = self.mongodb.get_collection('organizations').find_one({"_id": user['organization_id']})
        if not organization or not organization.get('active', False):
            return {"error": "Organization is not active"}, 403

        self._log.info(f"Service login successful for username={username} organization_id={user.get('organization_id')}")
        tokens = JwtGenerator.generate_tokens(
            subject=user.get('username'),
            organization_id=str(user.get('organization_id')),
            properties=user.get('properties', {}),
            secret=secret,
            issuer=self._jwt.get('issuer'),
            token_version=int(user.get('token_version', 0)),
            access_token_expiry=int(self._jwt.get('access_token_expiry_seconds', ACCESS_TOKEN_EXPIRY)),
            refresh_token_expiry=int(self._jwt.get('refresh_token_expiry_seconds', REFRESH_TOKEN_EXPIRY)),
        )

        return {"message": "Login successful", "tokens": tokens, "organization_id": str(user.get('organization_id'))}, 200
