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


class CleanExtractClient:
    def __init__(self, base_url="https://extract.getstringer.app"):
        self.base_url = base_url.rstrip("/")

    def execute(self, url_or_html, payment_signature=None):
        headers = {"Content-Type": "application/json"}
        if payment_signature:
            headers["PAYMENT-SIGNATURE"] = payment_signature

        request = urllib.request.Request(
            f"{self.base_url}/v1/execute",
            data=json.dumps({"url_or_html": url_or_html}).encode("utf-8"),
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = json.loads(error.read().decode("utf-8"))
            if error.code == 402:
                raise PaymentRequired(body, error.headers) from error
            raise
