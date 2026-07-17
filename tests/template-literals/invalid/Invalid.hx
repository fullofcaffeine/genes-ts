package;

import genes.TemplateLiteral;

class Invalid {
  static function arbitrary(value: String): String {
    return TemplateLiteral.value(value);
  }

  static function main(): Void {
    arbitrary('not authored as a template');
  }
}
