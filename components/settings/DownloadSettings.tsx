import type { ViewProps } from "react-native";
import { Switch } from "react-native-gesture-handler";
import { Stepper } from "@/components/inputs/Stepper";
import { ListGroup } from "@/components/list/ListGroup";
import { ListItem } from "@/components/list/ListItem";
import { useSettings } from "@/utils/atoms/settings";

interface Props extends ViewProps {}

export default function DownloadSettings({ ...props }: Props) {
  const { settings, updateSettings } = useSettings();

  return (
    <ListGroup title="Smart Downloads" {...props}>
      <ListItem
        title="Enable smart downloads"
        subtitle="Automatically download upcoming episodes and clean up watched ones"
      >
        <Switch
          value={settings.smartDownloadEnabled}
          onValueChange={(value) =>
            updateSettings({ smartDownloadEnabled: value })
          }
        />
      </ListItem>
      <ListItem
        title="Max download size (GB)"
        subtitle="Maximum total storage for smart downloads"
      >
        <Stepper
          disabled={!settings.smartDownloadEnabled}
          value={settings.smartDownloadMaxSizeGB}
          step={1}
          min={1}
          max={100}
          onUpdate={(value) =>
            updateSettings({ smartDownloadMaxSizeGB: value })
          }
          appendValue=" GB"
        />
      </ListItem>
      <ListItem
        title="Episodes watched before delete"
        subtitle="Number of episodes you must watch past a downloaded episode before it gets deleted"
      >
        <Stepper
          disabled={!settings.smartDownloadEnabled}
          value={settings.smartDownloadWatchedEpisodesBeforeDelete}
          step={1}
          min={1}
          max={10}
          onUpdate={(value) =>
            updateSettings({ smartDownloadWatchedEpisodesBeforeDelete: value })
          }
        />
      </ListItem>
    </ListGroup>
  );
}
