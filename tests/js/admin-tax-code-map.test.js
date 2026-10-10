/**
 * TWO-26153. "Tax codes for 0% lines" posts its whole mapping as one JSON
 * field: the dropdowns carry no name, so a large rate table cannot run past
 * PHP's max_input_vars and silently lose rows. admin.js rewrites the field on
 * every change, with a row count the server checks to refuse a field that
 * arrived cut short.
 */

"use strict";

const { loadAdmin } = require("./admin-harness");

const FIELD = "woocommerce_woocommerce-gateway-tillit_tax_code_map";

function addMappingField($, rows) {
  const selects = rows
    .map(function (row) {
      return (
        '<tr><td><select data-twoinc-tax-code-row="' +
        row[0] +
        '">' +
        '<option value="">(none)</option>' +
        '<option value="ES_IVA_EXPORT"' +
        (row[1] === "ES_IVA_EXPORT" ? ' selected="selected"' : "") +
        ">ES_IVA_EXPORT</option>" +
        '<option value="ES_IVA_INTRA_COMMUNITY"' +
        (row[1] === "ES_IVA_INTRA_COMMUNITY" ? ' selected="selected"' : "") +
        ">ES_IVA_INTRA_COMMUNITY</option>" +
        "</select></td></tr>"
      );
    })
    .join("");
  $("body").append(
    '<table><tr class="twoinc-tax-code-map-field"><td>' +
      '<input type="hidden" class="twoinc-tax-code-map-value" name="' +
      FIELD +
      '" value="server" />' +
      '<table class="widefat twoinc-tax-code-map"><tbody>' +
      selects +
      "</tbody></table></td></tr></table>"
  );
}

describe("tax code mapping field", () => {
  test.each([
    [
      "a change writes every row, (none) as empty",
      [
        ["standard|exempt", "ES_IVA_INTRA_COMMUNITY"],
        ["rate:11", ""],
        ["standard|none", ""]
      ],
      "standard|none",
      "ES_IVA_EXPORT",
      {
        rows: 3,
        map: { "standard|exempt": "ES_IVA_INTRA_COMMUNITY", "rate:11": "", "standard|none": "ES_IVA_EXPORT" }
      }
    ],
    [
      "setting a row back to (none) keeps it in the count",
      [
        ["standard|exempt", "ES_IVA_INTRA_COMMUNITY"],
        ["standard|none", "ES_IVA_EXPORT"]
      ],
      "standard|exempt",
      "",
      { rows: 2, map: { "standard|exempt": "", "standard|none": "ES_IVA_EXPORT" } }
    ]
  ])("%s", async (description, rows, changed, value, expected) => {
    const { $ } = await loadAdmin();
    addMappingField($, rows);
    expect($('select[data-twoinc-tax-code-row][name]').length).toBe(0);

    $('select[data-twoinc-tax-code-row="' + changed + '"]').val(value).trigger("change");

    expect(JSON.parse($(".twoinc-tax-code-map-value").val())).toEqual(expected);
  });

  test("the server-rendered value stands until a row changes", async () => {
    const { $ } = await loadAdmin();
    addMappingField($, [["standard|none", "ES_IVA_EXPORT"]]);
    expect($(".twoinc-tax-code-map-value").val()).toBe("server");
  });
});
