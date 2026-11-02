/**
 * English messages for checker findings, conversion changes and conversion
 * warnings. Placeholders such as {count} are filled in by `format`.
 * The codes are the stable API; the wording may improve between versions.
 */

import type { IssueCode } from "./check";
import type { ChangeCode, WarnCode } from "./convert7";

export interface Message {
  title: string;
  message: string;
}

export const ISSUE_MESSAGES: Record<IssueCode, Message> = {
  encoding_mislabeled: { title: "The header names the wrong character set", message: "The file says {declared}, but the text is really {used}. Programs that trust the header show accents as odd characters. repairGedcom writes UTF-8 with a matching header." },
  encoding_ansel: { title: "Old character set: ANSEL", message: "ANSEL is the character set of older GEDCOM files and many current programs read it badly. It was decoded correctly; repairGedcom writes UTF-8." },
  encoding_ansi: { title: "Windows character set (ANSI)", message: "The file uses a Windows character set instead of UTF-8. That works on one computer but often goes wrong on another. repairGedcom writes UTF-8." },
  encoding_no_char: { title: "No character set in the header", message: "The header has no CHAR line, so a program has to guess how to read accented letters. repairGedcom adds 1 CHAR UTF-8." },
  encoding_uncertain: { title: "Character set hard to tell", message: "The header says {declared}. The file was read as Windows-1252; check the names in accentSamples before using a repaired file." },
  encoding_unreadable: { title: "Characters could not be read: {count}", message: "Some bytes match no known character. They show as U+FFFD and cannot be restored automatically." },
  garbled_chars: { title: "Garbled characters (lines: {count})", message: "Text like \u00c3\u00a9 instead of \u00e9: the file was once read with the wrong character set and saved again. Lines that can be repaired exactly: {fixable}. Pass fixGarbled to repairGedcom if the examples look right." },
  head_missing: { title: "The file has no header (HEAD)", message: "Every GEDCOM file starts with 0 HEAD. Without it, many programs refuse the file. repairGedcom adds a minimal header." },
  head_not_first: { title: "The header is not at the top", message: "0 HEAD must be the first record. Something comes before it." },
  trlr_missing: { title: "The file has no end marker (TRLR)", message: "A GEDCOM file ends with 0 TRLR. Without it, the file may have been cut off during export or download, so check that the last records are complete. repairGedcom adds the end marker." },
  after_trlr: { title: "Text after the end marker", message: "There are lines after 0 TRLR ({count}). Programs ignore them, so that information does not get imported." },
  version_missing: { title: "No GEDCOM version", message: "The header does not say which GEDCOM version this is (GEDC VERS). Most programs then assume 5.5.1." },
  bad_line: { title: "Lines that are not GEDCOM: {count}", message: "Every line must start with a level number and a tag, such as 1 NAME. These do not, and programs skip them or stop." },
  level_jump: { title: "Levels that skip a step", message: "A line can be at most one level deeper than the line above it. Here the structure skips a level, so the data ends up in the wrong place." },
  leading_space: { title: "Indented lines", message: "GEDCOM lines should not have spaces before the level number, and some programs skip such lines. repairGedcom removes the indentation." },
  blank_lines: { title: "Empty lines: {count}", message: "Empty lines do not belong in a GEDCOM file and some programs stumble over them. repairGedcom leaves them out." },
  line_endings: { title: "Mixed line endings", message: "The file mixes Windows, Mac and Unix line endings (CRLF {crlf}, LF {lf}, CR {cr}). repairGedcom uses CRLF throughout." },
  line_too_long: { title: "Lines longer than 255 characters: {count}", message: "GEDCOM 5.5 and 5.5.1 allow at most 255 characters per line; longer text belongs in CONC lines. Some programs cut such lines off." },
  conc_in_v7: { title: "CONC in a GEDCOM 7 file", message: "GEDCOM 7.0 no longer has CONC. A program that reads version 7 may skip these lines, so pieces of notes go missing." },
  cont_misplaced: { title: "Continuation lines in the wrong place", message: "CONC and CONT continue the line above and must be exactly one level deeper. These are not, so text can end up in the wrong note." },
  duplicate_id: { title: "Duplicate IDs: {count}", message: "Two records share the same ID, such as @I12@. A program keeps one of the two, and links can point to the wrong person." },
  broken_pointer: { title: "Broken links: {count}", message: "A link points to an ID that does not exist in the file, for example a family that was deleted. Programs drop the link or stop importing." },
  one_sided_link: { title: "One-sided links: {count}", message: "A person says they belong to a family, but the family does not list them, or the other way round. Some programs then lose the relationship." },
  no_name: { title: "People without a name: {count}", message: "These people have no name, or only a placeholder. Some programs skip them on import, together with their links." },
  death_before_birth: { title: "People who died before they were born: {count}", message: "The date of death is before the date of birth. Usually a typing error in the year." },
  child_before_parent: { title: "Children born before a parent: {count}", message: "A child is born before their own father or mother. Often two people with the same name were mixed up." },
  parent_too_young: { title: "Parents younger than 12 at a child's birth: {count}", message: "Worth a second look: a parent who was not yet 12 when the child was born usually means a wrong date or a wrong link." },
  born_after_mother_death: { title: "Children born after their mother's death: {count}", message: "The child's date of birth is after the mother's date of death. Check both dates and the link." },
  too_old: { title: "People older than 120: {count}", message: "Birth and death are more than 120 years apart. Often a wrong year, or two people merged into one." },
  bad_date: { title: "Dates programs do not understand: {count}", message: "GEDCOM writes dates like 12 MAR 1850, ABT 1850 or BET 1850 AND 1855. Dates like 31.12.1850 are kept as text and cannot be sorted or compared." },
  empty_family: { title: "Empty families: {count}", message: "Family records without husband, wife or children. Harmless, but often left over from deleting people." },
  own_ancestor: { title: "People who are their own ancestor: {count}", message: "Following the parents from these people leads back to themselves. This loop breaks charts and calculations in most programs." },
};

export const CHANGE_MESSAGES: Record<ChangeCode, string> = {
  encoding: "Character set converted to UTF-8",
  header: "Header rewritten for the new version",
  conc_joined: "{count} CONC lines joined",
  long_lines_split: "{count} long lines split with CONC (5.5.1 allows 255 characters)",
  xref_renamed: "{count} IDs renamed to a valid form, with all pointers updated",
  at_signs: "{count} values with an @ sign rewritten for the new escape rule",
  shared_notes: "{count} shared notes and note pointers converted",
  media_records: "{count} embedded media links turned into media records",
  media_types: "{count} media formats converted",
  file_paths: "{count} file paths converted",
  source_records: "{count} written-out sources turned into source records",
  void_pointers: "{count} empty pointers converted",
  dates_calendar: "{count} dates with a calendar converted",
  dates_phrase: "{count} date phrases converted",
  dates_dual: "{count} dual years (such as 1648/9) converted, original kept as PHRASE",
  dates_epoch: "{count} B.C. dates converted",
  dates_range_swapped: "{count} date ranges put in order",
  dates_cleaned: "{count} dates written in standard form",
  ages: "{count} ages converted",
  enums: "{count} enumerated values (such as PEDI, RESN, NAME TYPE) converted",
  sex: "{count} SEX values converted",
  rela_role: "{count} associations converted (RELA and ROLE)",
  tran: "{count} romanised or phonetic names converted",
  exid: "{count} external IDs converted (AFN, RFN, RIN, EXID)",
  lang_tags: "{count} languages converted",
  name_pieces: "{count} name parts with commas split or joined",
  alia_text: "{count} aliases written as text turned into an extra name",
  ext_tags: "{count} non-standard tags kept as underscore tags",
  subm_added: "Submitter record added (required in 5.5.1)",
  uid: "{count} UID lines kept as _UID",
  levels_fixed: "{count} lines with a skipped level fixed",
};

export const WARNING_MESSAGES: Record<WarnCode, Message> = {
  no_head: { title: "No header found", message: "The file did not start with 0 HEAD. A new header was written; check that this really is a GEDCOM file." },
  already_target: { title: "The file already had this version", message: "It was rewritten anyway, which tidies it up." },
  bad_line: { title: "Lines without a level number", message: "These lines were added to the text of the line before, so nothing is lost." },
  date_phrase_only: { title: "Dates kept as text only", message: "These are not GEDCOM dates. The wording is kept in a PHRASE, but programs cannot sort or calculate with them." },
  age_phrase_only: { title: "Ages kept as text only", message: "These ages could not be read as years, months or days and are kept as text." },
  sex_lost: { title: "SEX values that do not exist in the target version", message: "These became U (unknown)." },
  lang_unknown: { title: "Unknown languages", message: "These language names have no known language code. They were written as und (undetermined)." },
  media_type_guessed: { title: "Unknown media formats", message: "No media type could be found for these files; application/octet-stream was used." },
  subn_removed: { title: "SUBN removed", message: "GEDCOM 7.0 has no submission record. It was only used to send files to the old Ancestral File and is removed." },
  blob_removed: { title: "Embedded media (BLOB) removed", message: "Pictures stored inside the file in the old 5.5 way cannot be kept in 7.0." },
  head_file_removed: { title: "HEAD FILE removed", message: "The original file name in the header does not exist in 7.0." },
  void_removed: { title: "Empty pointers removed", message: "5.5.1 has no @VOID@. These lines, and what was under them, were removed." },
  schma_removed: { title: "Extension definitions removed", message: "5.5.1 has no SCHMA. The extension tags themselves are kept, but the URIs that defined them are not." },
  html_note: { title: "Notes in HTML", message: "5.5.1 has no way to say a note is HTML, so the tags will show as plain text." },
  resn_dropped: { title: "Restriction values changed", message: "These RESN values do not exist in the target version, or there were several; only valid values were kept." },
  dangling_pointer: { title: "Pointers to records that do not exist", message: "These were left as they are. checkGedcom can help find them." },
  kept_as_extension: { title: "Kept as underscore tags", message: "These tags have no place in the target version. They are kept with an underscore so nothing is lost, but other programs may ignore them." },
};

/** Fills {name} placeholders from a parameter object. Unknown placeholders stay as they are. */
export function format(template: string, params: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (params[key] === undefined ? whole : String(params[key])));
}
