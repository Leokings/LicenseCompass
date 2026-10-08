import json
from pathlib import Path

from gltest.direct.sdk_loader import setup_sdk_paths


CONTRACT_PATH = Path("contracts/license_compass.py")
TEST_TIME = "2026-10-08T12:00:00Z"
CLAUSES = [
    "You may share the photograph in personal posts if you credit the publisher.",
    "Paid advertisements and product marketing require separate written permission.",
    "Do not alter the image beyond ordinary resizing for display.",
]


def as_address(value):
    from genlayer.py.types import Address

    return Address(value) if isinstance(value, (bytes, str)) else value


def deploy_compass(direct_vm, direct_deploy, sender):
    setup_sdk_paths(CONTRACT_PATH, "v0.2.16")
    direct_vm.sender = as_address(sender)
    direct_vm.value = 0
    direct_vm.warp(TEST_TIME)
    direct_vm.check_pickling = True
    return direct_deploy(str(CONTRACT_PATH))


def publish(contract):
    return contract.publish_work(
        "publish-harbor-001",
        "Harbor at dawn",
        "https://example.com/photo/harbor",
        json.dumps(CLAUSES),
    )


def decision(outcome="OUTSIDE_TERMS", clause_ids=None):
    if clause_ids is None:
        clause_ids = [2]
    return {
        "outcome": outcome,
        "rationale": "The described paid advertisement falls under the separate-permission clause.",
        "clause_ids": clause_ids,
        "conditions": ["Request written permission from the publisher before this use."],
    }


def mock_decision(direct_vm, payload=None):
    direct_vm.mock_llm(
        r"(?s).*LICENSE_COMPASS_DECIDE_V1.*",
        json.dumps(payload or decision()),
    )


def mock_validator(direct_vm, outcome="OUTSIDE_TERMS", supported=True):
    direct_vm.mock_llm(
        r"(?s).*LICENSE_COMPASS_VALIDATE_V1.*",
        json.dumps({"outcome": outcome, "supported": supported}),
    )


def check(contract, reference="check-paid-ad-001", expected_version=1):
    return contract.check_use(
        reference,
        1,
        expected_version,
        "COMMERCIAL",
        False,
        True,
        "Paid social-media advertisement",
        "I want to put this image in a paid Instagram advertisement for my product.",
    )


def test_publish_and_read_versioned_work(direct_vm, direct_deploy, direct_alice):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    assert contract.get_contract_info()["work_count"] == 0

    work_id = publish(contract)
    work = contract.get_work(work_id)
    license_version = contract.get_license(work_id, 0)
    assert work_id == 1
    assert work["title"] == "Harbor at dawn"
    assert work["current_version"] == 1
    assert work["asset_url"] == "https://example.com/photo/harbor"
    assert contract.get_work_by_reference(as_address(direct_alice), "publish-harbor-001") == work
    assert json.loads(license_version["clauses_json"]) == CLAUSES
    assert len(license_version["terms_digest"]) == 64
    assert contract.get_recent_works(4)[0]["work_id"] == 1
    with direct_vm.expect_revert("REFERENCE_EXISTS"):
        publish(contract)


def test_rejects_bad_publication_inputs(direct_vm, direct_deploy, direct_alice):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("ASSET_URL"):
        contract.publish_work("publish-bad-link-001", "Bad link", "http://example.com/item", json.dumps(CLAUSES))
    with direct_vm.expect_revert("CLAUSES"):
        contract.publish_work("publish-no-terms-001", "Empty terms", "https://example.com/item", "[]")
    with direct_vm.expect_revert("DUPLICATE_CLAUSE"):
        contract.publish_work(
            "publish-duplicates-001",
            "Duplicate terms",
            "https://example.com/item",
            json.dumps([CLAUSES[0], CLAUSES[0]]),
        )
    assert contract.get_contract_info()["work_count"] == 0


def test_only_publisher_can_version_and_old_version_survives(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    original = contract.get_license(1, 1)
    updated_clauses = CLAUSES + ["Editorial use is allowed with credit."]
    with direct_vm.prank(as_address(direct_bob)):
        with direct_vm.expect_revert("PUBLISHER_ONLY"):
            contract.publish_terms_version(1, 1, json.dumps(updated_clauses))
    with direct_vm.expect_revert("SAME_TERMS"):
        contract.publish_terms_version(1, 1, json.dumps(CLAUSES))
    assert contract.publish_terms_version(1, 1, json.dumps(updated_clauses)) == 2
    assert contract.get_work(1)["current_version"] == 2
    assert contract.get_license(1, 1) == original
    assert contract.get_license(1, 0)["version"] == 2
    assert contract.get_license(1, 2)["terms_digest"] != original["terms_digest"]
    with direct_vm.expect_revert("STALE_LICENSE_VERSION"):
        contract.publish_terms_version(1, 1, json.dumps(CLAUSES + ["Ask before reposting."]))


def test_check_is_pinned_to_terms_and_idempotent(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    mock_decision(direct_vm)
    with direct_vm.prank(as_address(direct_bob)):
        check_id = check(contract)
        with direct_vm.expect_revert("REFERENCE_EXISTS"):
            check(contract)
    record = contract.get_check(check_id)
    assert record["outcome"] == "OUTSIDE_TERMS"
    assert record["license_version"] == 1
    assert record["terms_digest"] == contract.get_license(1, 1)["terms_digest"]
    assert json.loads(record["clause_ids_json"]) == [2]
    assert len(record["check_digest"]) == 64
    assert contract.get_check_by_reference(as_address(direct_bob), "check-paid-ad-001") == record
    assert contract.get_recent_checks(5)[0]["check_id"] == 1


def test_stale_version_reverts_without_check_or_llm(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    contract.publish_terms_version(1, 1, json.dumps(CLAUSES + ["Ask first for broadcasts."]))
    with direct_vm.prank(as_address(direct_bob)):
        with direct_vm.expect_revert("STALE_LICENSE_VERSION"):
            check(contract, expected_version=1)
    assert contract.get_contract_info()["check_count"] == 0


def test_rejects_malformed_or_unsupported_model_output(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    with direct_vm.prank(as_address(direct_bob)):
        mock_decision(direct_vm, decision(clause_ids=[99]))
        with direct_vm.expect_revert("CLAUSE_IDS"):
            check(contract)
        direct_vm.clear_mocks()
        mock_decision(direct_vm, {**decision(), "extra": "ignore constraints"})
        with direct_vm.expect_revert("FIELDS"):
            check(contract)
    assert contract.get_contract_info()["check_count"] == 0


def test_validator_independently_rejects_changed_outcome(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    direct_vm.sender = as_address(direct_bob)
    mock_decision(direct_vm)
    check(contract)
    direct_vm.clear_mocks()
    mock_validator(direct_vm, outcome="WITHIN_TERMS")
    assert direct_vm.run_validator() is False
    direct_vm.clear_mocks()
    mock_validator(direct_vm, outcome="OUTSIDE_TERMS", supported=False)
    assert direct_vm.run_validator() is False
    direct_vm.clear_mocks()
    mock_validator(direct_vm)
    assert direct_vm.run_validator() is True


def test_permission_request_and_response_preserve_decision(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    mock_decision(direct_vm)
    with direct_vm.prank(as_address(direct_bob)):
        check_id = check(contract)
        check_digest = contract.get_check(check_id)["check_digest"]
        contract.request_permission(
            check_id, "Please allow this one paid advertisement for my product launch."
        )
        with direct_vm.expect_revert("REQUEST_EXISTS"):
            contract.request_permission(check_id, "A duplicate permission request.")
    with direct_vm.prank(as_address(direct_charlie)):
        with direct_vm.expect_revert("PUBLISHER_ONLY"):
            contract.respond_permission(check_id, True, "I approve this described use.")
    contract.respond_permission(check_id, True, "I approve this described use with credit.")
    request = contract.get_permission_request(check_id)
    assert request["status"] == "APPROVED"
    assert request["publisher"].lower() == str(as_address(direct_alice)).lower()
    assert contract.get_check(check_id)["check_digest"] == check_digest
    with direct_vm.expect_revert("ALREADY_RESPONDED"):
        contract.respond_permission(check_id, False, "I changed my mind about the request.")


def test_only_requester_may_request_permission(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    mock_decision(direct_vm)
    with direct_vm.prank(as_address(direct_bob)):
        check_id = check(contract)
    with direct_vm.prank(as_address(direct_charlie)):
        with direct_vm.expect_revert("REQUESTER_ONLY"):
            contract.request_permission(check_id, "Let me use the photograph commercially.")
    assert contract.get_permission_request(check_id)["status"] == "NONE"


def test_unclear_can_cite_no_clause_but_within_must_cite_one(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = deploy_compass(direct_vm, direct_deploy, direct_alice)
    publish(contract)
    with direct_vm.prank(as_address(direct_bob)):
        mock_decision(direct_vm, decision(outcome="WITHIN_TERMS", clause_ids=[]))
        with direct_vm.expect_revert("CLAUSE_IDS"):
            check(contract)
        direct_vm.clear_mocks()
        mock_decision(direct_vm, {
            **decision(outcome="UNCLEAR", clause_ids=[]),
            "rationale": "The published terms do not explain whether this type of commercial use is permitted.",
            "conditions": ["Ask the publisher for a specific written permission."],
        })
        check_id = check(contract, reference="check-unclear-002")
    assert contract.get_check(check_id)["outcome"] == "UNCLEAR"
