import { listWpiLog } from "../app/features/log-analysis/core";
import { formatNumber, openCliInput, printCliError } from "./cli-utils";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

try {
  const input = await openCliInput(args[0]);
  const listing = await listWpiLog(input.source);
  if (args.includes("--json")) {
    console.log(
      JSON.stringify(
        { ...listing, file: { ...listing.file, sizeBytes: input.sizeBytes } },
        null,
        2,
      ),
    );
  } else {
    console.log(input.absolutePath);
    console.log(
      `WPILOG ${listing.header.majorVersion}.${listing.header.minorVersion} | ${listing.header.extraHeader || "no extra header"}`,
    );
    console.log(
      `${formatNumber(input.sizeBytes, 0)} bytes | ${formatNumber(listing.file.recordCount, 0)} complete records | ${listing.entries.length} entries`,
    );
    if (listing.file.truncatedTail) {
      console.log(
        `Tail truncated at byte ${listing.file.truncatedTail.offset}; missing ${listing.file.truncatedTail.missingBytes ?? "unknown"} bytes`,
      );
    }
    for (const entry of [...listing.entries].sort((left, right) => left.name.localeCompare(right.name))) {
      console.log(
        `${entry.entryId.toString().padStart(5)}  ${entry.type.padEnd(14)} ${entry.recordCount.toString().padStart(8)}  ${entry.name}`,
      );
    }
  }
} catch (error) {
  printCliError(error);
}
