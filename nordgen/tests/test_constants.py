from nord_config_generator.constants import (
    ALIAS_TO_GROUP_ID,
    GROUP_ID_TO_ALIAS,
    TYPE_GROUPS,
)


def test_group_mappings_are_bidirectional() -> None:
    assert set(GROUP_ID_TO_ALIAS) == TYPE_GROUPS
    reverse = {alias: identifier for identifier, alias in GROUP_ID_TO_ALIAS.items()}
    assert reverse == ALIAS_TO_GROUP_ID
    assert ALIAS_TO_GROUP_ID["standard"] == "legacy_standard"
