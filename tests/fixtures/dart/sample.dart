class Counter {
  int _count = 0;

  int get count => _count;

  void increment() {
    _count++;
  }

  void decrement() {
    _count--;
  }

  void reset() {
    _count = 0;
  }
}

String formatCount(int count) {
  return 'Count: $count';
}

bool isEven(int number) {
  return number % 2 == 0;
}
