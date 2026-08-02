package constants

import "testing"

func TestGroupMappings(t *testing.T) {
	tests := map[string]string{
		"standard":  GroupStandardID,
		"p2p":       GroupP2PID,
		"dedicated": GroupDedicatedID,
		"onion":     GroupOnionID,
		"double":    GroupDoubleID,
	}
	for alias, identifier := range tests {
		if !IsTypeGroup(identifier) {
			t.Errorf("IsTypeGroup(%q) = false", identifier)
		}
		actualIdentifier, exists := GroupID(alias)
		if !exists || actualIdentifier != identifier {
			t.Errorf("GroupID(%q) = %q, %v", alias, actualIdentifier, exists)
		}
		actualAlias, exists := GroupAlias(identifier)
		if !exists || actualAlias != alias {
			t.Errorf("GroupAlias(%q) = %q, %v", identifier, actualAlias, exists)
		}
	}
	if IsTypeGroup("unknown") {
		t.Fatal("IsTypeGroup accepted unknown identifier")
	}
	if _, exists := GroupID("unknown"); exists {
		t.Fatal("GroupID accepted unknown alias")
	}
	if _, exists := GroupAlias("unknown"); exists {
		t.Fatal("GroupAlias accepted unknown identifier")
	}
}
