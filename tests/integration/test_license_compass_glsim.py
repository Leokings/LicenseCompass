"""Five-validator GLSim consensus and permission flow for License Compass."""

import json
from pathlib import Path

from gltest import create_accounts, get_contract_factory, get_validator_factory
from gltest.assertions import tx_execution_succeeded
from gltest.types import TransactionStatus
from gltest.utils import extract_contract_address


TEST_DATETIME = "2026-10-08T12:00:00Z"
CLAUSES = [
    "You may share the photograph in personal posts if you credit the publisher.",
    "Paid advertisements and product marketing require separate written permission.",
]


def _compact(value) -> str:
    return json.dumps(value, separators=(",", ":"))


def _receipt_dump(receipt) -> str:
    return json.dumps(receipt, indent=2, sort_keys=True, default=str)


def _deploy():
    owner, visitor = create_accounts(2)
    path = Path(__file__).resolve().parents[2] / "contracts" / "license_compass.py"
    factory = get_contract_factory(contract_file_path=path)
    receipt = factory.deploy_contract_tx(
        args=[], account=owner, wait_transaction_status=TransactionStatus.FINALIZED
    )
    assert tx_execution_succeeded(receipt), _receipt_dump(receipt)
    address = extract_contract_address(receipt)
    return (
        factory.build_contract(address, account=owner),
        factory.build_contract(address, account=visitor),
    )


def _validators() -> dict:
    validators = get_validator_factory().batch_create_mock_validators(
        5,
        mock_llm_response={
            "nondet_exec_prompt": {
                "LICENSE_COMPASS_DECIDE_V1": _compact(
                    {
                        "outcome": "OUTSIDE_TERMS",
                        "rationale": "A paid product advertisement requires separate written permission.",
                        "clause_ids": [2],
                        "conditions": ["Ask the publisher before using the work in this advertisement."],
                    }
                ),
                "LICENSE_COMPASS_VALIDATE_V1": _compact(
                    {"outcome": "OUTSIDE_TERMS", "supported": True}
                ),
            }
        },
    )
    return {
        "validators": [validator.to_dict() for validator in validators],
        "genvm_datetime": TEST_DATETIME,
    }


def test_deploy_and_publish_versioned_terms():
    owner, _visitor = _deploy()
    assert owner.get_contract_info(args=[]).call()["contract_version"] == "0.3.0"
    publication = owner.publish_work(
        args=["publish-harbor-001", "Harbor at dawn", "https://example.com/photo/harbor", _compact(CLAUSES)]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(publication), _receipt_dump(publication)
    assert owner.get_work(args=[1]).call()["current_version"] == 1
    assert json.loads(owner.get_license(args=[1, 0]).call()["clauses_json"]) == CLAUSES


def test_consensus_check_then_permission_response():
    owner, visitor = _deploy()
    publication = owner.publish_work(
        args=["publish-harbor-001", "Harbor at dawn", "https://example.com/photo/harbor", _compact(CLAUSES)]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(publication), _receipt_dump(publication)

    receipt = visitor.check_use(
        args=[
            "glsim-paid-ad-001", 1, 1, "COMMERCIAL", False, True,
            "Paid social-media advertisement",
            "I want to include this photo in a paid Instagram advertisement for my product.",
        ]
    ).transact(
        transaction_context=_validators(),
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(receipt), _receipt_dump(receipt)
    check = visitor.get_check(args=[1]).call()
    assert check["outcome"] == "OUTSIDE_TERMS"
    assert check["license_version"] == 1
    assert json.loads(check["clause_ids_json"]) == [2]
    assert len(check["check_digest"]) == 64

    request = visitor.request_permission(
        args=[1, "May I use this photo once in my paid product advertisement?"]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(request), _receipt_dump(request)
    assert visitor.get_permission_request(args=[1]).call()["status"] == "PENDING"

    response = owner.respond_permission(
        args=[1, True, "I approve the described one-time advertisement with credit."]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(response), _receipt_dump(response)
    assert visitor.get_permission_request(args=[1]).call()["status"] == "APPROVED"
    assert visitor.get_check(args=[1]).call()["check_digest"] == check["check_digest"]


def test_consensus_recovers_from_malformed_initial_citations():
    owner, visitor = _deploy()
    publication = owner.publish_work(
        args=["publish-repair-001", "Harbor at dawn", "https://example.com/photo/harbor", _compact(CLAUSES)]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(publication), _receipt_dump(publication)

    valid = {
        "outcome": "OUTSIDE_TERMS",
        "rationale": "A paid product advertisement requires separate written permission.",
        "clause_ids": [2],
        "conditions": ["Ask the publisher before using the work in this advertisement."],
    }
    validators = get_validator_factory().batch_create_mock_validators(
        5,
        mock_llm_response={
            "nondet_exec_prompt": {
                "LICENSE_COMPASS_DECIDE_V1": _compact({**valid, "clause_ids": []}),
                "LICENSE_COMPASS_REPAIR_V1": _compact(valid),
                "LICENSE_COMPASS_VALIDATE_V1": _compact(
                    {"outcome": "OUTSIDE_TERMS", "supported": True}
                ),
            }
        },
    )
    receipt = visitor.check_use(
        args=[
            "glsim-repair-001", 1, 1, "COMMERCIAL", False, True,
            "Paid social-media advertisement",
            "I want to include this photo in a paid Instagram advertisement for my product.",
        ]
    ).transact(
        transaction_context={
            "validators": [validator.to_dict() for validator in validators],
            "genvm_datetime": TEST_DATETIME,
        },
        wait_transaction_status=TransactionStatus.FINALIZED,
    )
    assert tx_execution_succeeded(receipt), _receipt_dump(receipt)
    assert json.loads(visitor.get_check(args=[1]).call()["clause_ids_json"]) == [2]


def test_long_unicode_terms_do_not_exhaust_validator_prompt_budget():
    owner, visitor = _deploy()
    clauses = [f"Clause {index} allows credited noncommercial sharing. " + "🧭" * 200 for index in range(1, 9)]
    clauses[1] = "Paid advertisements require separate written permission. " + "🧭" * 200
    publication = owner.publish_work(
        args=["publish-unicode-001", "Compass art", "https://example.com/compass", json.dumps(clauses, ensure_ascii=False)]
    ).transact(wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(publication), _receipt_dump(publication)

    receipt = visitor.check_use(
        args=[
            "glsim-unicode-001", 1, 1, "COMMERCIAL", False, True,
            "Paid social-media advertisement",
            "I want to include this image in a paid Instagram advertisement for my product.",
        ]
    ).transact(transaction_context=_validators(), wait_transaction_status=TransactionStatus.FINALIZED)
    assert tx_execution_succeeded(receipt), _receipt_dump(receipt)
    assert visitor.get_check(args=[1]).call()["outcome"] == "OUTSIDE_TERMS"
