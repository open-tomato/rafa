# Epic progress for the tomato theme, read from rafa's board cache
# (`.rafa/cache/board.json`). Run with `--argjson n <issue>` for a spec
# branch, or `--argjson n null` off one. Prints one tab-separated line:
#
#   <kind> <number> <title> <closed> <total>
#
# kind `spec`: the spec's number and title, and the progress of its epic.
# kind `roadmap`: the epic `rafa next` walks, the first open `horizon:now`
# epic in the Roadmap issue's order, with its number, title and progress.
# An epic's members are the issues carrying its `epic:<slug>` label, the
# epic itself left out. A field with nothing to show is empty.

def labels: [.labels[]?.name];
def has($label): labels | index($label) != null;
def epic_slug: labels | map(select(startswith("epic:"))) | first;

.rows as $rows
| def progress($slug):
    [$rows[] | select(has($slug) and (has("type:epic") | not))] as $members
    | [($members | map(select(.state == "CLOSED")) | length), ($members | length)];

if $n != null then
  ($rows | map(select(.number == $n)) | first) as $spec
  | ($spec | if . == null then null else epic_slug end) as $slug
  | (if $slug == null then ["", ""] else progress($slug) end) as $p
  | ["spec", $n, ($spec.title // ""), $p[0], $p[1]]
else
  ($rows | map(select(.title == "Roadmap")) | first) as $roadmap
  | [($roadmap.body // "") | scan("#([0-9]+)") | .[0] | tonumber] as $order
  | [$rows[] | select(has("type:epic") and has("horizon:now") and .state == "OPEN")] as $now
  | ([$order[] as $o | $now[] | select(.number == $o)] + ($now | sort_by(.number)))
  | first as $epic
  | if $epic == null then ["roadmap", "", "", "", ""]
    else ($epic | epic_slug) as $slug
      | (if $slug == null then ["", ""] else progress($slug) end) as $p
      | ["roadmap", $epic.number, $epic.title, $p[0], $p[1]]
    end
end
| @tsv
