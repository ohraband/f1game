from django.db import models


class Race(models.Model):
    class Status(models.TextChoices):
        GRID = "grid", "On the grid"
        RUNNING = "running", "Running"
        FINISHED = "finished", "Finished"

    name = models.CharField(max_length=80)
    track = models.CharField(max_length=30)
    laps = models.PositiveSmallIntegerField(default=3)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.GRID)
    created_at = models.DateTimeField(auto_now_add=True)
    # Full simulation output (positions per tick), served by /races/<id>/replay/
    replay = models.JSONField(null=True, blank=True)
    # Live simulation state while status == running (cleared when finished)
    state = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class Competitor(models.Model):
    race = models.ForeignKey(Race, on_delete=models.CASCADE, related_name="competitors")
    name = models.CharField(max_length=40)
    color = models.CharField(max_length=7)
    grid_slot = models.PositiveSmallIntegerField()  # 0 = pole
    is_player = models.BooleanField(default=False)  # driven by the human
    pace = models.FloatField()                       # car "quality", rolled when added
    # Saved result stats
    finish_position = models.PositiveSmallIntegerField(null=True, blank=True)
    finish_time = models.FloatField(null=True, blank=True)  # seconds

    class Meta:
        ordering = ["grid_slot"]
        constraints = [models.UniqueConstraint(fields=["race", "grid_slot"], name="uniq_race_slot")]

    def __str__(self):
        return f"{self.name} ({self.race})"
