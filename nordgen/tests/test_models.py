import pytest

from nord_config_generator.models import MAX_KEEPALIVE, UserPreferences


@pytest.mark.parametrize(
    "preferences",
    [
        UserPreferences(dns="1.1.1.1", keepalive=25),
        UserPreferences(dns="2606:4700:4700::1111", keepalive=0),
        UserPreferences(dns=" 1.1.1.1 ", keepalive=MAX_KEEPALIVE),
    ],
)
def test_user_preferences_accept_valid_values(preferences: UserPreferences) -> None:
    preferences.validate()


@pytest.mark.parametrize(
    "preferences, message",
    [
        (UserPreferences(dns="invalid"), "DNS"),
        (UserPreferences(keepalive=-1), "keepalive"),
        (UserPreferences(keepalive=MAX_KEEPALIVE + 1), "keepalive"),
    ],
)
def test_user_preferences_reject_invalid_values(
    preferences: UserPreferences,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        preferences.validate()
