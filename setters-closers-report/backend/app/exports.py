"""CSV and Excel exports of a generated (or draft) report, with the same colours as the dashboard."""
import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


def _title(report: dict, draft: bool) -> str:
    s = report.get("session", {})
    t = f"{report['title']} - {s.get('date', '')} {s.get('slot_label', '')}"
    if report.get("version"):
        t += f" (v{report['version']})"
    return t + (" - DRAFT, not generated" if draft else "")


def to_csv(report: dict, draft: bool = False) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    metrics = report["metrics"]
    w.writerow([_title(report, draft)])
    for sec, label in (("setters", "Setters"), ("closers", "Closers")):
        w.writerow([])
        w.writerow([f"{label} Performance"])
        w.writerow(["Rank", "Agent"] + [m["label"] + (" (min)" if m["kind"] == "duration" else "") for m in metrics])
        for r in report[sec]["rows"]:
            w.writerow([r["rank"], r["name"]] + [_raw(r["values"].get(m["key"])) for m in metrics])
        t = report[sec]["totals"]
        w.writerow(["", "Total"] + [_raw(t[m["key"]]["total"]) if m.get("show_total", True) else "" for m in metrics])
        w.writerow(["", "Average"] + [_raw(t[m["key"]]["average"], 2) if m.get("show_average", True) else "" for m in metrics])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _raw(v, nd: int = 2):
    if v is None:
        return "N/A"
    return int(v) if abs(v - round(v)) < 1e-9 else round(v, nd)


def to_xlsx(report: dict, draft: bool = False) -> bytes:
    f = report["formatting"]
    fills = {"met": PatternFill("solid", fgColor=f["met_bg"].lstrip("#")),
             "below": PatternFill("solid", fgColor=f["below_bg"].lstrip("#"))}
    fonts = {"met": Font(color=f["met_text"].lstrip("#")), "below": Font(color=f["below_text"].lstrip("#"))}
    head_fill = PatternFill("solid", fgColor="F1F3F7")
    thin = Side(style="thin", color="DADFE7")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    metrics = report["metrics"]

    wb = Workbook()
    ws = wb.active
    ws.title = "Report"
    ws["A1"] = _title(report, draft)
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = "Light red = below target   Light green = target achieved   N/A = not in the uploaded files"
    ws["A2"].font = Font(color="667085", size=9)
    row = 4
    for sec, label in (("setters", "Setters Performance"), ("closers", "Closers Performance")):
        ws.cell(row, 1, label).font = Font(bold=True, size=12)
        row += 1
        heads = ["Rank", "Agent"] + [m["label"] + (" (min)" if m["kind"] == "duration" else "") for m in metrics]
        for c, h in enumerate(heads, 1):
            cell = ws.cell(row, c, h)
            cell.font, cell.fill, cell.border = Font(bold=True), head_fill, border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        row += 1
        for r in report[sec]["rows"]:
            ws.cell(row, 1, r["rank"]).border = border
            ws.cell(row, 2, r["name"]).border = border
            for c, m in enumerate(metrics, 3):
                v = r["values"].get(m["key"])
                cell = ws.cell(row, c, "N/A" if v is None else (v / 100 if m["kind"] == "percent" else v))
                cell.border = border
                cell.alignment = Alignment(horizontal="center")
                cell.number_format = {"percent": "0.0%", "duration": "0.0", "count": "#,##0"}.get(m["kind"], "#,##0.##")
                st = r["status"].get(m["key"])
                if st in fills:
                    cell.fill, cell.font = fills[st], fonts[st]
                elif v is None:
                    cell.font = Font(color="98A2B3", italic=True)
            row += 1
        t = report[sec]["totals"]
        for lab, part, show in (("Total", "total", "show_total"), ("Average", "average", "show_average")):
            ws.cell(row, 2, lab).font = Font(bold=True)
            for c, m in enumerate(metrics, 3):
                if not m.get(show, True):
                    continue
                v = t[m["key"]][part]
                cell = ws.cell(row, c, "N/A" if v is None else (v / 100 if m["kind"] == "percent" else v))
                cell.font = Font(bold=True)
                cell.alignment = Alignment(horizontal="center")
                cell.number_format = {"percent": "0.0%", "duration": "0.0", "count": "#,##0"}.get(m["kind"], "#,##0.##")
                if part == "average" and m["kind"] == "count":
                    cell.number_format = "0.0"
            row += 1
        row += 2
    ws.column_dimensions["A"].width = 7
    ws.column_dimensions["B"].width = 28
    for c in range(3, len(metrics) + 3):
        ws.column_dimensions[get_column_letter(c)].width = 16

    src = wb.create_sheet("Source files")
    src.append(["Kind", "File", "Uploaded at (UTC)", "Checksum", "Read with"])
    for fi in report.get("files", []):
        src.append([fi["label"], fi["filename"], fi["uploaded_at"], fi["sha"], fi.get("provider") or ""])
    if report.get("warnings"):
        src.append([])
        src.append(["Warnings at generation"])
        for wmsg in report["warnings"]:
            src.append([wmsg])
    for c in range(1, 6):
        src.column_dimensions[get_column_letter(c)].width = 30
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
