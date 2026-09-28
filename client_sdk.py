"""Small standard-library client for the hosted CleanExtract REST endpoint."""

import json
import urllib.error
import urllib.request


class PaymentRequired(Exception):
    """Raised with the decoded x402 challenge for an unpaid request."""

    def __init__(self, challenge, headers):
        super().__init__("CleanExtract requires an x402 payment")
        self.challenge = challenge
        self.headers = dict(headers)


FAILURE_STATUSES = frozenset({
    "upstream_timeout", "upstream_http_error", "bot_challenge", "js_shell",
    "empty_extraction", "sections_not_found",
})


class CleanExtractFailure(Exception):
    """An uncharged named extraction failure."""

    def __init__(self, status, reason, http_status, details):
        super().__init__(f"{status}: {reason}")
        self.status = status
        self.reason = reason
        self.http_status = http_status
        self.charged = False
        self.details = details


class CleanExtractClient:
    def __init__(self, base_url="https://extract.getstringer.app"):
        self.base_url = base_url.rstrip("/")

    def _post(self, path, payload, payment_signature=None):
        headers = {"Content-Type": "application/json"}
        if payment_signature:
            headers["PAYMENT-SIGNATURE"] = payment_signature

        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=payload.encode("utf-8"),
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = json.loads(error.read().decode("utf-8"))
            if error.code == 402:
                raise PaymentRequired(body, error.headers) from error
            if isinstance(body, dict) and body.get("status") in FAILURE_STATUSES:
                raise CleanExtractFailure(body["status"], body.get("reason", ""), error.code, body) from error
            raise

    def outline(self, url_or_html):
        return self._post("/v1/outline", json.dumps(dict(url_or_html=url_or_html)))

    def execute(self, url_or_html, payment_signature=None, sections=None):
        if sections is None:
            payload = json.dumps({"url_or_html": url_or_html})
        else:
            body = dict(url_or_html=url_or_html, sections=sections)
            payload = json.dumps(body)
        return self._post("/v1/execute", payload, payment_signature)
