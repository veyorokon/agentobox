import asyncio
import os

import pytest
from agent.scripts.modal_managed_harness import run_managed_modal_contract


pytestmark = [pytest.mark.contract]


@pytest.mark.skipif(
    os.environ.get("AGENTOBOX_RUN_MODAL_CONTRACT_TESTS") != "1",
    reason="set AGENTOBOX_RUN_MODAL_CONTRACT_TESTS=1 to run Modal managed contract tests",
)
def test_managed_modal_contract_boots_runtime_and_serves_health():
    asyncio.run(
        run_managed_modal_contract(
            image_ref=os.environ.get("AGENTOBOX_MODAL_CONTRACT_IMAGE", "").strip(),
            callback_url=os.environ.get("AGENTOBOX_MODAL_CONTRACT_CALLBACK_URL", "https://example.com/graphql"),
            stability_window_s=5.0,
            required_services=("firefox",),
        )
    )
